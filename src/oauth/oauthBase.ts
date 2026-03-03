import * as arctic from "arctic"

export type OAuthState = {
    telegramUserId: string
}

export type PkceOAuthState = OAuthState & {
    codeVerifier: string
}

export type OAuthAction = "code exchange" | "token refresh"

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

export class AuthorizationRequiredError extends Error {
    authorizationUrl: string

    constructor(providerName: string, errorName: string, authorizationUrl: string) {
        super(`${providerName} authorization required`)
        this.name = errorName
        this.authorizationUrl = authorizationUrl
    }
}

export function requireOAuthConfig(input: OAuthConfigInput): OAuthConfig {
    if (!input.clientId) throw new Error(`Missing ${input.clientIdEnvName}`)
    if (!input.clientSecret) throw new Error(`Missing ${input.clientSecretEnvName}`)

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
