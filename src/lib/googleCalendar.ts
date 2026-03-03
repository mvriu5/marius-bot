import * as arctic from "arctic"
import {
    AuthorizationRequiredError,
    buildOAuthRedirectUri,
    createInvalidOAuthCallbackError,
    formatArcticOAuthError,
    requireOAuthConfig,
    type PkceOAuthState
} from "../oauth/oauthBase.js"
import { AuthError, ProviderError } from "../errors/appError.js"
import {
    OAUTH_STATE_TTL_MS,
    createTelegramOAuthKeys,
    deleteStateValue,
    getStateValue,
    isTokenValid,
    setStateValue
} from "../oauth/oauthState.js"

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

const keys = createTelegramOAuthKeys("google")

type StoredGoogleToken = {
    accessToken: string
    refreshToken: string
    expiresAt: number
}

export class GoogleAuthorizationRequiredError extends AuthorizationRequiredError {
    constructor(authorizationUrl: string) {
        super("Google", "GoogleAuthorizationRequiredError", authorizationUrl)
    }
}

function getGoogleClient() {
    const config = requireOAuthConfig({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        clientIdEnvName: "GOOGLE_CLIENT_ID",
        clientSecretEnvName: "GOOGLE_CLIENT_SECRET"
    })

    return new arctic.Google(
        config.clientId,
        config.clientSecret,
        buildOAuthRedirectUri(config.honoUrl, "google")
    )
}

async function saveToken(
    telegramUserId: string,
    accessToken: string,
    expiresAt: number,
    refreshToken: string
) {
    await setStateValue<StoredGoogleToken>(keys.tokenKey(telegramUserId), {
        accessToken,
        refreshToken,
        expiresAt
    })
}

export async function isGoogleCalendarConnected(telegramUserId: string) {
    const token = await getStateValue<StoredGoogleToken>(keys.tokenKey(telegramUserId))
    return Boolean(token?.refreshToken)
}

export async function createGoogleAuthorizationUrl(telegramUserId: string) {
    const google = getGoogleClient()
    const stateId = arctic.generateState()
    const codeVerifier = arctic.generateCodeVerifier()
    await setStateValue<PkceOAuthState>(
        keys.oauthStateKey(stateId),
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
    if (!code) throw createInvalidOAuthCallbackError("Google", "Missing OAuth code")
    if (!stateId) throw createInvalidOAuthCallbackError("Google", "Missing OAuth state")

    const oauthState = await getStateValue<PkceOAuthState>(keys.oauthStateKey(stateId))
    if (!oauthState?.telegramUserId) {
        throw createInvalidOAuthCallbackError("Google", "Invalid or expired OAuth state")
    }
    if (!oauthState.codeVerifier) {
        throw new AuthError(
            "GOOGLE_OAUTH_CODE_VERIFIER_MISSING",
            "Google Anmeldung ist ungültig oder abgelaufen. Bitte neu verbinden.",
            401,
            "Missing OAuth code_verifier"
        )
    }

    const google = getGoogleClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await google.validateAuthorizationCode(code, oauthState.codeVerifier)
    } catch (error) {
        throw new ProviderError(
            "google",
            "GOOGLE_OAUTH_CODE_EXCHANGE_FAILED",
            "Google Anmeldung konnte nicht abgeschlossen werden.",
            502,
            formatArcticOAuthError("Google", "code exchange", error),
            error
        )
    }

    const existingToken = await getStateValue<StoredGoogleToken>(keys.tokenKey(oauthState.telegramUserId))
    const refreshToken = tokens.hasRefreshToken()
        ? tokens.refreshToken()
        : existingToken?.refreshToken
    if (!refreshToken) {
        throw new ProviderError(
            "google",
            "GOOGLE_REFRESH_TOKEN_MISSING",
            "Google Anmeldung ist unvollständig. Bitte erneut verbinden.",
            502,
            "Google token response missing refresh_token"
        )
    }

    await saveToken(
        oauthState.telegramUserId,
        tokens.accessToken(),
        tokens.accessTokenExpiresAt().getTime(),
        refreshToken
    )
    await deleteStateValue(keys.oauthStateKey(stateId))
    return { telegramUserId: oauthState.telegramUserId }
}

async function refreshGoogleToken(telegramUserId: string, refreshToken: string) {
    const google = getGoogleClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await google.refreshAccessToken(refreshToken)
    } catch (error) {
        throw new ProviderError(
            "google",
            "GOOGLE_TOKEN_REFRESH_FAILED",
            "Google Token konnte nicht erneuert werden.",
            502,
            formatArcticOAuthError("Google", "token refresh", error),
            error
        )
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
    const token = await getStateValue<StoredGoogleToken>(keys.tokenKey(telegramUserId))
    if (!token) {
        const url = await createGoogleAuthorizationUrl(telegramUserId)
        throw new GoogleAuthorizationRequiredError(url)
    }

    if (isTokenValid(token.expiresAt)) {
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
        timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone
    })

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "google",
            "GOOGLE_CALENDAR_API_ERROR",
            "Google Calendar Daten konnten nicht geladen werden.",
            502,
            `Google Calendar API error (${response.status}): ${details}`
        )
    }

    return (await response.json()) as GoogleCalendarEventsResponse
}

export async function getTodayCalendarEventsSummary(telegramUserId: string) {
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
