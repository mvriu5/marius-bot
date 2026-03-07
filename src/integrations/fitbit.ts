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

type FitbitActivitiesDateResponse = {
    summary?: {
        steps?: number
        distances?: Array<{
            activity?: string
            distance?: number
        }>
        caloriesOut?: number
        floors?: number
        lightlyActiveMinutes?: number
        fairlyActiveMinutes?: number
        veryActiveMinutes?: number
    }
}

type FitbitStepsSeriesResponse = {
    ["activities-steps"]?: Array<{
        dateTime?: string
        value?: string
    }>
}

type FitbitDistanceSeriesResponse = {
    ["activities-distance"]?: Array<{
        dateTime?: string
        value?: string
    }>
}

type FitbitCaloriesSeriesResponse = {
    ["activities-calories"]?: Array<{
        dateTime?: string
        value?: string
    }>
}

type FitbitVeryActiveSeriesResponse = {
    ["activities-minutesVeryActive"]?: Array<{
        dateTime?: string
        value?: string
    }>
}

type FitbitFairlyActiveSeriesResponse = {
    ["activities-minutesFairlyActive"]?: Array<{
        dateTime?: string
        value?: string
    }>
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

type FitbitActivitySummary = {
    steps: number
    distanceKm: number
    caloriesOut: number
    floors: number
    lightlyActiveMinutes: number
    fairlyActiveMinutes: number
    veryActiveMinutes: number
    activeMinutes: number
}

type FitbitWeekActivitySummary = {
    days: number
    avgSteps: number
    avgDistanceKm: number
    avgCaloriesOut: number
    avgActiveMinutes: number
    bestStepsDate: string | null
    bestSteps: number
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
    const scope = "heartrate sleep profile activity"

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

function resolveFitbitApiUserId(fitbitUserId?: string) {
    return fitbitUserId || "-"
}

function getDistanceFromSummary(summary: FitbitActivitiesDateResponse["summary"]) {
    const totalDistance = summary?.distances?.find((entry) => entry.activity === "total")?.distance
    if (typeof totalDistance === "number") return totalDistance
    return 0
}

export async function getFitbitActivityData(telegramUserId: string): Promise<FitbitActivitySummary> {
    const validToken = await getValidAccessTokenForUser(telegramUserId)
    const userIdForApi = resolveFitbitApiUserId(validToken.fitbitUserId)
    const date = getTodayDateString()

    const response = await fetchFitbitJson<FitbitActivitiesDateResponse>(
        validToken.accessToken,
        `/1/user/${userIdForApi}/activities/date/${date}.json`
    )

    const summary = response.summary ?? {}
    const lightlyActiveMinutes = summary.lightlyActiveMinutes ?? 0
    const fairlyActiveMinutes = summary.fairlyActiveMinutes ?? 0
    const veryActiveMinutes = summary.veryActiveMinutes ?? 0

    return {
        steps: summary.steps ?? 0,
        distanceKm: getDistanceFromSummary(summary),
        caloriesOut: summary.caloriesOut ?? 0,
        floors: summary.floors ?? 0,
        lightlyActiveMinutes,
        fairlyActiveMinutes,
        veryActiveMinutes,
        activeMinutes: lightlyActiveMinutes + fairlyActiveMinutes + veryActiveMinutes
    }
}

function toDailyValueMap(
    values: Array<{ dateTime?: string; value?: string }> | undefined
) {
    const map = new Map<string, number>()
    for (const item of values ?? []) {
        if (!item.dateTime) continue
        const parsed = Number(item.value ?? "0")
        map.set(item.dateTime, Number.isFinite(parsed) ? parsed : 0)
    }
    return map
}

function avg(values: number[]) {
    if (values.length === 0) return 0
    const sum = values.reduce((acc, current) => acc + current, 0)
    return sum / values.length
}

export async function getFitbitWeekActivityData(telegramUserId: string): Promise<FitbitWeekActivitySummary> {
    const validToken = await getValidAccessTokenForUser(telegramUserId)
    const userIdForApi = resolveFitbitApiUserId(validToken.fitbitUserId)

    const [stepsResult, distanceResult, caloriesResult, veryActiveResult, fairlyActiveResult] = await Promise.allSettled([
        fetchFitbitJson<FitbitStepsSeriesResponse>(
            validToken.accessToken,
            `/1/user/${userIdForApi}/activities/steps/date/today/7d.json`
        ),
        fetchFitbitJson<FitbitDistanceSeriesResponse>(
            validToken.accessToken,
            `/1/user/${userIdForApi}/activities/distance/date/today/7d.json`
        ),
        fetchFitbitJson<FitbitCaloriesSeriesResponse>(
            validToken.accessToken,
            `/1/user/${userIdForApi}/activities/calories/date/today/7d.json`
        ),
        fetchFitbitJson<FitbitVeryActiveSeriesResponse>(
            validToken.accessToken,
            `/1/user/${userIdForApi}/activities/minutesVeryActive/date/today/7d.json`
        ),
        fetchFitbitJson<FitbitFairlyActiveSeriesResponse>(
            validToken.accessToken,
            `/1/user/${userIdForApi}/activities/minutesFairlyActive/date/today/7d.json`
        )
    ])

    const steps = stepsResult.status === "fulfilled" ? toDailyValueMap(stepsResult.value["activities-steps"]) : new Map()
    const distance = distanceResult.status === "fulfilled" ? toDailyValueMap(distanceResult.value["activities-distance"]) : new Map()
    const calories = caloriesResult.status === "fulfilled" ? toDailyValueMap(caloriesResult.value["activities-calories"]) : new Map()
    const veryActive = veryActiveResult.status === "fulfilled"
        ? toDailyValueMap(veryActiveResult.value["activities-minutesVeryActive"])
        : new Map()
    const fairlyActive = fairlyActiveResult.status === "fulfilled"
        ? toDailyValueMap(fairlyActiveResult.value["activities-minutesFairlyActive"])
        : new Map()

    const dates = new Set<string>([
        ...steps.keys(),
        ...distance.keys(),
        ...calories.keys(),
        ...veryActive.keys(),
        ...fairlyActive.keys()
    ])

    const dailyRows = [...dates].sort().map((date) => {
        const daySteps = steps.get(date) ?? 0
        const dayDistance = distance.get(date) ?? 0
        const dayCalories = calories.get(date) ?? 0
        const dayActiveMinutes = (veryActive.get(date) ?? 0) + (fairlyActive.get(date) ?? 0)
        return { date, daySteps, dayDistance, dayCalories, dayActiveMinutes }
    })

    const best = dailyRows.reduce<{ date: string | null; steps: number }>(
        (current, row) => (row.daySteps > current.steps ? { date: row.date, steps: row.daySteps } : current),
        { date: null, steps: 0 }
    )

    return {
        days: dailyRows.length,
        avgSteps: avg(dailyRows.map((row) => row.daySteps)),
        avgDistanceKm: avg(dailyRows.map((row) => row.dayDistance)),
        avgCaloriesOut: avg(dailyRows.map((row) => row.dayCalories)),
        avgActiveMinutes: avg(dailyRows.map((row) => row.dayActiveMinutes)),
        bestStepsDate: best.date,
        bestSteps: best.steps
    }
}
