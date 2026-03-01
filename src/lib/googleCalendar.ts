import { ensureStateConnected, state } from "../types/state.js"

type GoogleTokenResponse = {
    access_token: string
    expires_in: number
    refresh_token?: string
    scope?: string
    token_type?: string
}

type GoogleCalendarEventsResponse = {
    items?: Array<{
        summary?: string
        location?: string
        start?: {
            dateTime?: string
            date?: string
        }
        end?: {
            dateTime?: string
            date?: string
        }
    }>
}

type GoogleCalendarEvent = NonNullable<GoogleCalendarEventsResponse["items"]>[number]

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const honoUrl = process.env.HONO_URL
const calendarTimezone = process.env.GOOGLE_CALENDAR_TIMEZONE

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const TOKEN_KEY_PREFIX = "google:token:telegram:"
const OAUTH_STATE_KEY_PREFIX = "google:oauth:state:"

type StoredGoogleToken = {
    accessToken: string
    refreshToken: string
    expiresAt: number
}

type StoredOAuthState = {
    telegramUserId: string
}

export class GoogleAuthorizationRequiredError extends Error {
    authorizationUrl: string

    constructor(authorizationUrl: string) {
        super("Google authorization required")
        this.name = "GoogleAuthorizationRequiredError"
        this.authorizationUrl = authorizationUrl
    }
}

function requireOAuthConfig() {
    if (!googleClientId) throw new Error("Missing GOOGLE_CLIENT_ID")
    if (!googleClientSecret) throw new Error("Missing GOOGLE_CLIENT_SECRET")
    if (!honoUrl) throw new Error("Missing HONO_URL")
}

function getGoogleRedirectUri() {
    requireOAuthConfig()
    return `${honoUrl!.replace(/\/+$/, "")}/api/google/callback`
}

function tokenKey(telegramUserId: string) {
    return `${TOKEN_KEY_PREFIX}${telegramUserId}`
}

function oauthStateKey(stateId: string) {
    return `${OAUTH_STATE_KEY_PREFIX}${stateId}`
}

function newStateId() {
    return `google_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

async function saveToken(
    telegramUserId: string,
    tokenData: GoogleTokenResponse,
    existingRefreshToken?: string
) {
    const refreshToken = tokenData.refresh_token ?? existingRefreshToken
    if (!refreshToken) {
        throw new Error("Google token response missing refresh_token")
    }

    await ensureStateConnected()
    await state.set<StoredGoogleToken>(tokenKey(telegramUserId), {
        accessToken: tokenData.access_token,
        refreshToken,
        expiresAt: Date.now() + tokenData.expires_in * 1000
    })
}

async function loadToken(telegramUserId: string) {
    await ensureStateConnected()
    return state.get<StoredGoogleToken>(tokenKey(telegramUserId))
}

export async function isGoogleCalendarConnected(telegramUserId: string) {
    const token = await loadToken(telegramUserId)
    return Boolean(token?.refreshToken)
}

export async function createGoogleAuthorizationUrl(telegramUserId: string) {
    await ensureStateConnected()

    const stateId = newStateId()
    await state.set<StoredOAuthState>(
        oauthStateKey(stateId),
        { telegramUserId },
        OAUTH_STATE_TTL_MS
    )

    const params = new URLSearchParams({
        client_id: googleClientId!,
        redirect_uri: getGoogleRedirectUri(),
        response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar.readonly",
        access_type: "offline",
        prompt: "consent",
        state: stateId
    })

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function requestToken(params: URLSearchParams) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
    })

    if (!response.ok) {
        const details = await response.text()
        throw new Error(`Google token request failed (${response.status}): ${details}`)
    }

    return (await response.json()) as GoogleTokenResponse
}

export async function handleGoogleOAuthCallback(code: string, stateId: string) {
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
        client_id: googleClientId!,
        client_secret: googleClientSecret!,
        redirect_uri: getGoogleRedirectUri()
    })

    const tokenData = await requestToken(params)
    await saveToken(oauthState.telegramUserId, tokenData)
    await state.delete(oauthStateKey(stateId))
    return { telegramUserId: oauthState.telegramUserId, tokenData }
}

async function refreshGoogleToken(telegramUserId: string, refreshToken: string) {
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: googleClientId!,
        client_secret: googleClientSecret!
    })

    const tokenData = await requestToken(params)
    await saveToken(telegramUserId, tokenData, refreshToken)
    return tokenData
}

async function getValidAccessTokenForUser(telegramUserId: string) {
    const token = await loadToken(telegramUserId)
    if (!token) {
        const url = await createGoogleAuthorizationUrl(telegramUserId)
        throw new GoogleAuthorizationRequiredError(url)
    }

    if (Date.now() < token.expiresAt - 60_000) {
        return token.accessToken
    }

    const refreshed = await refreshGoogleToken(telegramUserId, token.refreshToken)
    return refreshed.access_token
}

function getTodayWindow() {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)

    return {
        timeMin: start.toISOString(),
        timeMax: end.toISOString()
    }
}

function formatEventTime(event: GoogleCalendarEvent) {
    const startDateTime = event.start?.dateTime
    const endDateTime = event.end?.dateTime
    if (!startDateTime || !endDateTime) {
        return "Ganztägig"
    }

    const formatter = new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
    })

    const start = formatter.format(new Date(startDateTime))
    const end = formatter.format(new Date(endDateTime))
    return `${start}-${end}`
}

async function fetchTodayEvents(accessToken: string) {
    const { timeMin, timeMax } = getTodayWindow()
    const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "15",
        timeZone: calendarTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    })

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    })

    if (!response.ok) {
        const details = await response.text()
        throw new Error(`Google Calendar API error (${response.status}): ${details}`)
    }

    return (await response.json()) as GoogleCalendarEventsResponse
}

export async function getTodayCalendarSummaryMessage(telegramUserId: string) {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const eventsResponse = await fetchTodayEvents(accessToken)
    const events = eventsResponse.items ?? []

    if (events.length === 0) {
        return "Heute stehen keine Termine im Google Calendar."
    }

    const lines = [
        "Heutige Termine:",
        ...events.map((event) => {
            const title = event.summary || "Ohne Titel"
            const time = formatEventTime(event)
            const location = event.location ? ` (${event.location})` : ""
            return `- ${time} ${title}${location}`
        })
    ]

    return lines.join("\n")
}
