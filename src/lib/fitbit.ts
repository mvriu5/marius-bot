import {
    OAUTH_STATE_TTL_MS,
    createTelegramOAuthKeys,
    deleteStateValue,
    getStateValue,
    isTokenValid,
    setStateValue
} from "../oauth/oauthState.js"
import {
    AuthorizationRequiredError,
    buildOAuthRedirectUri,
    createInvalidOAuthCallbackError,
    type OAuthState,
    requireOAuthConfig
} from "../oauth/oauthBase.js"
import { ProviderError } from "../errors/appError.js"

type FitbitSleepResponse = {
    sleep?: Array<{
        isMainSleep?: boolean
    }>
    summary?: {
        totalMinutesAsleep?: number
        totalTimeInBed?: number
    }
}

type FitbitHrvResponse = {
    hrv?: Array<{
        value?: {
            dailyRmssd?: number
            deepRmssd?: number
        }
    }>
}

type FitbitHeartIntradayResponse = {
    ["activities-heart-intraday"]?: {
        dataset?: Array<{ value: number }>
    }
}

type FitbitTokenResponse = {
    access_token: string
    expires_in: number
    refresh_token: string
    scope?: string
    token_type?: string
    user_id?: string
}

const keys = createTelegramOAuthKeys("fitbit")

type StoredFitbitToken = {
    accessToken: string
    refreshToken: string
    expiresAt: number
    fitbitUserId?: string
}

type FitbitDailySummary = {
    totalMinutesAsleep: number
    totalTimeInBed: number
    hrvDailyRmssd: number | null
    lowestHeartRate: number | null
}

export class FitbitAuthorizationRequiredError extends AuthorizationRequiredError {
    constructor(authorizationUrl: string) {
        super("Fitbit", "FitbitAuthorizationRequiredError", authorizationUrl)
    }
}

function getFitbitConfig() {
    return requireOAuthConfig({
        clientId: process.env.FITBIT_CLIENT_ID!,
        clientSecret: process.env.FITBIT_CLIENT_SECRET!,
        clientIdEnvName: "FITBIT_CLIENT_ID",
        clientSecretEnvName: "FITBIT_CLIENT_SECRET"
    })
}

function getBasicAuthHeader() {
    const config = getFitbitConfig()
    return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`
}

function newStateId() {
    return `fitbit_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10)
}

async function saveToken(telegramUserId: string, tokenData: FitbitTokenResponse) {
    await setStateValue<StoredFitbitToken>(keys.tokenKey(telegramUserId), {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        fitbitUserId: tokenData.user_id
    })
}

export async function isFitbitConnected(telegramUserId: string) {
    const token = await getStateValue<StoredFitbitToken>(keys.tokenKey(telegramUserId))
    return Boolean(token?.refreshToken)
}

export async function createFitbitAuthorizationUrl(telegramUserId: string) {
    const stateId = newStateId()
    await setStateValue<OAuthState>(
        keys.oauthStateKey(stateId),
        { telegramUserId },
        OAUTH_STATE_TTL_MS
    )

    const config = getFitbitConfig()
    const redirectUri = buildOAuthRedirectUri(config.honoUrl, "fitbit")
    const scope = "heartrate sleep profile"

    return `https://www.fitbit.com/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope,
        state: stateId
    }).toString()}`
}

async function requestToken(params: URLSearchParams) {
    const response = await fetch("https://api.fitbit.com/oauth2/token", {
        method: "POST",
        headers: {
            Authorization: getBasicAuthHeader(),
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "fitbit",
            "FITBIT_TOKEN_REQUEST_FAILED",
            "Fitbit Anmeldung ist derzeit nicht verfügbar.",
            502,
            `Fitbit token request failed (${response.status}): ${details}`
        )
    }

    return (await response.json()) as FitbitTokenResponse
}

export async function handleFitbitOAuthCallback(code: string, stateId: string) {
    if (!code) throw createInvalidOAuthCallbackError("Fitbit", "Missing OAuth code")
    if (!stateId) throw createInvalidOAuthCallbackError("Fitbit", "Missing OAuth state")

    const oauthState = await getStateValue<OAuthState>(keys.oauthStateKey(stateId))
    if (!oauthState?.telegramUserId) {
        throw createInvalidOAuthCallbackError("Fitbit", "Invalid or expired OAuth state")
    }

    const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: buildOAuthRedirectUri(getFitbitConfig().honoUrl, "fitbit")
    })

    const tokenData = await requestToken(params)
    await saveToken(oauthState.telegramUserId, tokenData)
    await deleteStateValue(keys.oauthStateKey(stateId))
    return { telegramUserId: oauthState.telegramUserId, tokenData }
}

async function refreshFitbitToken(telegramUserId: string, refreshToken: string) {
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
    })

    const tokenData = await requestToken(params)
    await saveToken(telegramUserId, tokenData)
    return tokenData
}

async function getValidAccessTokenForUser(telegramUserId: string) {
    const token = await getStateValue<StoredFitbitToken>(keys.tokenKey(telegramUserId))
    if (!token) {
        const url = await createFitbitAuthorizationUrl(telegramUserId)
        throw new FitbitAuthorizationRequiredError(url)
    }

    if (isTokenValid(token.expiresAt)) {
        return {
            accessToken: token.accessToken,
            fitbitUserId: token.fitbitUserId
        }
    }

    const refreshed = await refreshFitbitToken(telegramUserId, token.refreshToken)
    return {
        accessToken: refreshed.access_token,
        fitbitUserId: refreshed.user_id
    }
}

async function fetchFitbitJson<T>(accessToken: string, path: string): Promise<T> {

    const response = await fetch(`https://api.fitbit.com${path}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "fitbit",
            "FITBIT_API_ERROR",
            "Fitbit Daten konnten nicht geladen werden.",
            502,
            `Fitbit API error (${response.status}): ${details}`
        )
    }

    return response.json() as Promise<T>
}

export async function getFitbitData(telegramUserId: string): Promise<FitbitDailySummary> {
    const validToken = await getValidAccessTokenForUser(telegramUserId)
    const userIdForApi = validToken.fitbitUserId
    const date = getTodayDateString()

    const requests = {
        sleep: fetchFitbitJson<FitbitSleepResponse>(validToken.accessToken, `/1.2/user/${userIdForApi}/sleep/date/${date}.json`),
        hrv: fetchFitbitJson<FitbitHrvResponse>(validToken.accessToken, `/1/user/${userIdForApi}/hrv/date/${date}.json`),
        heartIntraday: fetchFitbitJson<FitbitHeartIntradayResponse>(validToken.accessToken, `/1/user/${userIdForApi}/activities/heart/date/${date}/${date}/1min.json`)
    } as const

    const [sleepResult, hrvResult, heartIntradayResult] = await Promise.allSettled([
        requests.sleep,
        requests.hrv,
        requests.heartIntraday
    ])

    const sleep = sleepResult.status === "fulfilled" ? sleepResult.value : {}
    const hrv = hrvResult.status === "fulfilled" ? hrvResult.value : {}
    const heartIntraday = heartIntradayResult.status === "fulfilled" ? heartIntradayResult.value : {}

    const sleepSummary = sleep.summary ?? {}
    const mainSleep = sleep.sleep?.find((entry) => entry.isMainSleep) ?? sleep.sleep?.[0]
    const hrvValue = hrv.hrv?.[0]?.value
    const heartRates = heartIntraday["activities-heart-intraday"]?.dataset?.map((entry) => entry.value) ?? []
    const lowestHeartRate = heartRates.length > 0 ? Math.min(...heartRates) : null

    return {
        totalMinutesAsleep: sleepSummary.totalMinutesAsleep ?? 0,
        totalTimeInBed: sleepSummary.totalTimeInBed ?? 0,
        hrvDailyRmssd: hrvValue?.dailyRmssd ?? null,
        lowestHeartRate
    }
}
