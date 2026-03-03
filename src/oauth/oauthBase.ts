import * as arctic from "arctic"
import { AuthError, ProviderError } from "../errors/appError.js"

export type OAuthState = {
    telegramUserId: string
}

export type PkceOAuthState = OAuthState & {
    codeVerifier: string
}

type OAuthAction = "code exchange" | "token refresh"

type OAuthConfigInput = {
    clientId: string | undefined
    clientSecret: string | undefined
    clientIdEnvName: string
    clientSecretEnvName: string
}

type OAuthConfig = {
    clientId: string
    clientSecret: string
    honoUrl: string
}

export class AuthorizationRequiredError extends AuthError {
    authorizationUrl: string

    constructor(providerName: string, errorName: string, authorizationUrl: string) {
        super(
            "OAUTH_AUTHORIZATION_REQUIRED",
            `${providerName} ist nicht verbunden. Bitte führe den Login aus.`,
            401,
            `${providerName} authorization required`
        )
        this.name = errorName
        this.authorizationUrl = authorizationUrl
    }
}

export function requireOAuthConfig(input: OAuthConfigInput): OAuthConfig {
    if (!input.clientId) {
        throw new ProviderError(
            "config",
            "MISSING_OAUTH_CLIENT_ID",
            "OAuth Konfiguration ist unvollständig.",
            500,
            `Missing ${input.clientIdEnvName}`
        )
    }
    if (!input.clientSecret) {
        throw new ProviderError(
            "config",
            "MISSING_OAUTH_CLIENT_SECRET",
            "OAuth Konfiguration ist unvollständig.",
            500,
            `Missing ${input.clientSecretEnvName}`
        )
    }

    return {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        honoUrl: process.env.HONO_URL!
    }
}

export function buildOAuthRedirectUri(honoUrl: string, provider: string) {
    return `${honoUrl.replace(/\/+$/, "")}/api/${provider}/callback`
}

export function formatArcticOAuthError(providerName: string, action: OAuthAction, error: unknown) {
    if (error instanceof arctic.OAuth2RequestError) {
        const description = error.description ? ` (${error.description})` : ""
        return `${providerName} OAuth ${action} failed: ${error.code}${description}`
    }

    if (error instanceof arctic.ArcticFetchError) {
        return `${providerName} OAuth ${action} failed: network error while contacting ${providerName}`
    }

    if (error instanceof arctic.UnexpectedResponseError) {
        return `${providerName} OAuth ${action} failed: unexpected HTTP status ${error.status}`
    }

    if (error instanceof arctic.UnexpectedErrorResponseBodyError) {
        return `${providerName} OAuth ${action} failed: unexpected error response body (${error.status})`
    }

    if (error instanceof Error) {
        return `${providerName} OAuth ${action} failed: ${error.message}`
    }

    return `${providerName} OAuth ${action} failed`
}

export function createInvalidOAuthCallbackError(providerName: string, details: string) {
    return new AuthError(
        "OAUTH_CALLBACK_INVALID",
        `${providerName} Anmeldung ist ungültig oder abgelaufen. Bitte neu verbinden.`,
        401,
        details
    )
}
