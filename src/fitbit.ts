import { ensureStateConnected, state } from "./state.js"

type FitbitActivitiesResponse = {
    summary?: {
        steps?: number
        caloriesOut?: number
        distances?: Array<{ activity: string; distance: number }>
        lightlyActiveMinutes?: number
        fairlyActiveMinutes?: number
        veryActiveMinutes?: number
        restingHeartRate?: number
    }
}

type FitbitSleepResponse = {
    summary?: {
        totalMinutesAsleep?: number
        totalTimeInBed?: number
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

const fitbitClientId = process.env.FITBIT_CLIENT_ID
const fitbitClientSecret = process.env.FITBIT_CLIENT_SECRET
const fitbitUserId = process.env.FITBIT_USER_ID
const honoUrl = process.env.HONO_URL

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const TOKEN_KEY_PREFIX = "fitbit:token:telegram:"
const OAUTH_STATE_KEY_PREFIX = "fitbit:oauth:state:"

type StoredFitbitToken = {
    accessToken: string
    refreshToken: string
    expiresAt: number
    fitbitUserId?: string
}

type StoredOAuthState = {
    telegramUserId: string
}

export class FitbitAuthorizationRequiredError extends Error {
    authorizationUrl: string

    constructor(authorizationUrl: string) {
        super("Fitbit authorization required")
        this.name = "FitbitAuthorizationRequiredError"
        this.authorizationUrl = authorizationUrl
    }
}

function requireOAuthConfig() {
    if (!fitbitClientId) throw new Error("Missing FITBIT_CLIENT_ID")
    if (!fitbitClientSecret) throw new Error("Missing FITBIT_CLIENT_SECRET")
    if (!honoUrl) throw new Error("Missing HONO_URL")
}

function getFitbitRedirectUri() {
    requireOAuthConfig()
    return `${honoUrl!.replace(/\/+$/, "")}/api/fitbit/callback`
}

function getBasicAuthHeader() {
    requireOAuthConfig()
    return `Basic ${Buffer.from(`${fitbitClientId}:${fitbitClientSecret}`).toString("base64")}`
}

function tokenKey(telegramUserId: string) {
    return `${TOKEN_KEY_PREFIX}${telegramUserId}`
}

function oauthStateKey(stateId: string) {
    return `${OAUTH_STATE_KEY_PREFIX}${stateId}`
}

function newStateId() {
    return `fitbit_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function formatMinutes(totalMinutes: number | undefined) {
    if (!totalMinutes || totalMinutes <= 0) return "0m"

    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60

    if (hours === 0) return `${minutes}m`
    return `${hours}h ${minutes}m`
}

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10)
}

async function saveToken(telegramUserId: string, tokenData: FitbitTokenResponse) {
    await ensureStateConnected()
    await state.set<StoredFitbitToken>(tokenKey(telegramUserId), {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        fitbitUserId: tokenData.user_id
    })
}

async function loadToken(telegramUserId: string) {
    await ensureStateConnected()
    return state.get<StoredFitbitToken>(tokenKey(telegramUserId))
}

export async function createFitbitAuthorizationUrl(telegramUserId: string) {
    await ensureStateConnected()

    const stateId = newStateId()
    await state.set<StoredOAuthState>(
        oauthStateKey(stateId),
        { telegramUserId },
        OAUTH_STATE_TTL_MS
    )

    const redirectUri = getFitbitRedirectUri()
    const scope = "activity heartrate sleep profile"

    return `https://www.fitbit.com/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: fitbitClientId!,
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
        throw new Error(`Fitbit token request failed (${response.status}): ${details}`)
    }

    return (await response.json()) as FitbitTokenResponse
}

export async function handleFitbitOAuthCallback(code: string, stateId: string) {
    if (!code) throw new Error("Missing OAuth code")
    if (!stateId) throw new Error("Missing OAuth state")

    await ensureStateConnected()
    const oauthState = await state.get<StoredOAuthState>(oauthStateKey(stateId))
    if (!oauthState?.telegramUserId) {
        throw new Error("Invalid or expired OAuth state")
    }

    const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: getFitbitRedirectUri()
    })

    const tokenData = await requestToken(params)
    await saveToken(oauthState.telegramUserId, tokenData)
    await state.delete(oauthStateKey(stateId))
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
    const token = await loadToken(telegramUserId)
    if (!token) {
        const url = await createFitbitAuthorizationUrl(telegramUserId)
        throw new FitbitAuthorizationRequiredError(url)
    }

    if (Date.now() < token.expiresAt - 60_000) {
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
        throw new Error(`Fitbit API error (${response.status}): ${details}`)
    }

    return response.json() as Promise<T>
}

export async function getFitbitDailySummaryMessage(telegramUserId: string) {
    const validToken = await getValidAccessTokenForUser(telegramUserId)
    const userIdForApi = fitbitUserId ?? validToken.fitbitUserId ?? "-"
    const date = getTodayDateString()

    const [activities, sleep] = await Promise.all([
        fetchFitbitJson<FitbitActivitiesResponse>(validToken.accessToken, `/1/user/${userIdForApi}/activities/date/${date}.json`),
        fetchFitbitJson<FitbitSleepResponse>(validToken.accessToken, `/1/user/${userIdForApi}/sleep/date/${date}.json`)
    ])

    const activitySummary = activities.summary ?? {}
    const sleepSummary = sleep.summary ?? {}
    const totalDistance = activitySummary.distances?.find((entry) => entry.activity === "total")?.distance ?? 0
    const activeMinutes =
        (activitySummary.lightlyActiveMinutes ?? 0) +
        (activitySummary.fairlyActiveMinutes ?? 0) +
        (activitySummary.veryActiveMinutes ?? 0)

    return [
        "Fitbit Tagesuebersicht:",
        `- Schritte: ${activitySummary.steps ?? 0}`,
        `- Distanz: ${totalDistance.toFixed(2)} km`,
        `- Kalorien: ${activitySummary.caloriesOut ?? 0} kcal`,
        `- Aktive Minuten: ${activeMinutes}`,
        `- Ruhepuls: ${activitySummary.restingHeartRate ?? "n/a"} bpm`,
        `- Schlaf: ${formatMinutes(sleepSummary.totalMinutesAsleep)} (im Bett: ${formatMinutes(sleepSummary.totalTimeInBed)})`
    ].join("\n")
}
