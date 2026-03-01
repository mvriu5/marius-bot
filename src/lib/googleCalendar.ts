import { ensureStateConnected, state } from "../types/state.js"
import * as arctic from "arctic"

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
    codeVerifier: string
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

function getGoogleClient() {
    requireOAuthConfig()
    return new arctic.Google(googleClientId!, googleClientSecret!, getGoogleRedirectUri())
}

function tokenKey(telegramUserId: string) {
    return `${TOKEN_KEY_PREFIX}${telegramUserId}`
}

function oauthStateKey(stateId: string) {
    return `${OAUTH_STATE_KEY_PREFIX}${stateId}`
}

function formatGoogleOAuthError(action: "code exchange" | "token refresh", error: unknown) {
    if (error instanceof arctic.OAuth2RequestError) {
        const description = error.description ? ` (${error.description})` : ""
        return `Google OAuth ${action} failed: ${error.code}${description}`
    }

    if (error instanceof arctic.ArcticFetchError) {
        return `Google OAuth ${action} failed: network error while contacting Google`
    }

    if (error instanceof arctic.UnexpectedResponseError) {
        return `Google OAuth ${action} failed: unexpected HTTP status ${error.status}`
    }

    if (error instanceof arctic.UnexpectedErrorResponseBodyError) {
        return `Google OAuth ${action} failed: unexpected error response body (${error.status})`
    }

    if (error instanceof Error) {
        return `Google OAuth ${action} failed: ${error.message}`
    }

    return `Google OAuth ${action} failed`
}

async function saveToken(
    telegramUserId: string,
    accessToken: string,
    expiresAt: number,
    refreshToken: string
) {
    await ensureStateConnected()
    await state.set<StoredGoogleToken>(tokenKey(telegramUserId), {
        accessToken,
        refreshToken,
        expiresAt
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

    const google = getGoogleClient()
    const stateId = arctic.generateState()
    const codeVerifier = arctic.generateCodeVerifier()
    await state.set<StoredOAuthState>(
        oauthStateKey(stateId),
        { telegramUserId, codeVerifier },
        OAUTH_STATE_TTL_MS
    )

    const url = google.createAuthorizationURL(stateId, codeVerifier, [
        "https://www.googleapis.com/auth/calendar.readonly"
    ])
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")
    return url.toString()
}

export async function handleGoogleOAuthCallback(code: string, stateId: string) {
    if (!code) throw new Error("Missing OAuth code")
    if (!stateId) throw new Error("Missing OAuth state")

    await ensureStateConnected()
    const oauthState = await state.get<StoredOAuthState>(oauthStateKey(stateId))
    if (!oauthState?.telegramUserId) {
        throw new Error("Invalid or expired OAuth state")
    }
    if (!oauthState.codeVerifier) {
        throw new Error("Missing OAuth code_verifier")
    }

    const google = getGoogleClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await google.validateAuthorizationCode(code, oauthState.codeVerifier)
    } catch (error) {
        throw new Error(formatGoogleOAuthError("code exchange", error))
    }

    const existingToken = await loadToken(oauthState.telegramUserId)
    const refreshToken = tokens.hasRefreshToken()
        ? tokens.refreshToken()
        : existingToken?.refreshToken
    if (!refreshToken) {
        throw new Error("Google token response missing refresh_token")
    }

    await saveToken(
        oauthState.telegramUserId,
        tokens.accessToken(),
        tokens.accessTokenExpiresAt().getTime(),
        refreshToken
    )
    await state.delete(oauthStateKey(stateId))
    return { telegramUserId: oauthState.telegramUserId }
}

async function refreshGoogleToken(telegramUserId: string, refreshToken: string) {
    const google = getGoogleClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await google.refreshAccessToken(refreshToken)
    } catch (error) {
        throw new Error(formatGoogleOAuthError("token refresh", error))
    }

    const updatedRefreshToken = tokens.hasRefreshToken()
        ? tokens.refreshToken()
        : refreshToken

    await saveToken(
        telegramUserId,
        tokens.accessToken(),
        tokens.accessTokenExpiresAt().getTime(),
        updatedRefreshToken
    )
    return tokens.accessToken()
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

    return refreshGoogleToken(telegramUserId, token.refreshToken)
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
