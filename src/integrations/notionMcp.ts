import * as arctic from "arctic"
import { createHash, randomBytes } from "node:crypto"
import { ProviderError } from "../errors/appError.js"
import { AuthorizationRequiredError, buildOAuthRedirectUri, createInvalidOAuthCallbackError, type OAuthState } from "../oauth/oauthBase.js"
import { OAUTH_STATE_TTL_MS, createTelegramOAuthKeys, deleteStateValue, getStateValue, isTokenValid, setStateValue } from "../oauth/oauthState.js"

const keys = createTelegramOAuthKeys("notion-mcp")
const DEFAULT_NOTION_MCP_SERVER_URL = "https://mcp.notion.com/mcp"

type OAuthMetadata = {
    issuer?: string
    authorization_endpoint: string
    token_endpoint: string
    registration_endpoint?: string
}

type ProtectedResourceMetadata = {
    authorization_servers?: string[]
}

type ClientCredentials = {
    client_id: string
    client_secret?: string
}

type TokenResponse = {
    access_token: string
    token_type: string
    expires_in?: number
    refresh_token?: string
    scope?: string
}

type NotionMcpOAuthState = OAuthState & {
    codeVerifier: string
    clientId: string
    clientSecret?: string
    tokenEndpoint: string
}

type StoredNotionMcpToken = {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scope?: string
    tokenEndpoint: string
    clientId: string
    clientSecret?: string
}

export class NotionMcpAuthorizationRequiredError extends AuthorizationRequiredError {
    constructor(authorizationUrl: string) {
        super("Notion MCP", "NotionMcpAuthorizationRequiredError", authorizationUrl)
    }
}

function getNotionMcpServerUrl() {
    return process.env.NOTION_MCP_SERVER_URL?.trim() || DEFAULT_NOTION_MCP_SERVER_URL
}

function requireHonoUrl() {
    const honoUrl = process.env.HONO_URL?.trim()
    if (!honoUrl) {
        throw new ProviderError(
            "config",
            "MISSING_HONO_URL",
            "OAuth Konfiguration ist unvollstÃ¤ndig.",
            500,
            "Missing HONO_URL"
        )
    }
    return honoUrl
}

function base64UrlEncode(buffer: Buffer): string {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "")
}

function generatePkceCodeVerifier(): string {
    return base64UrlEncode(randomBytes(32))
}

function generatePkceCodeChallenge(codeVerifier: string): string {
    return base64UrlEncode(createHash("sha256").update(codeVerifier).digest())
}

async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
    const endpointUrl = new URL(serverUrl)
    const normalizedPath = endpointUrl.pathname.replace(/\/+$/g, "")
    const protectedResourceCandidates = [
        new URL("/.well-known/oauth-protected-resource", endpointUrl.origin).toString(),
        new URL(
            `/.well-known/oauth-protected-resource${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`,
            endpointUrl.origin
        ).toString(),
        new URL(`${normalizedPath || "/"}/.well-known/oauth-protected-resource`, endpointUrl.origin).toString()
    ]

    let authServerUrl: string | undefined
    const attempted: string[] = []

    for (const candidate of protectedResourceCandidates) {
        attempted.push(candidate)
        const response = await fetch(candidate, {
            headers: { Accept: "application/json" }
        })

        if (response.ok) {
            const protectedResource = (await response.json()) as ProtectedResourceMetadata
            authServerUrl = protectedResource.authorization_servers?.[0]
            if (authServerUrl) break
            continue
        }

        // Some servers expose authorization hints only via WWW-Authenticate on 401/403.
        if (response.status === 401 || response.status === 403) {
            const wwwAuthenticate = response.headers.get("www-authenticate") ?? ""
            const authServerMatch = wwwAuthenticate.match(/authorization_server="?([^",\s]+)"?/i)
            if (authServerMatch?.[1]) {
                authServerUrl = authServerMatch[1]
                break
            }
        }
    }

    if (!authServerUrl) {
        throw new ProviderError(
            "notion-mcp",
            "MCP_DISCOVERY_FAILED",
            "Notion MCP OAuth Discovery ist fehlgeschlagen.",
            502,
            `No authorization server found. Tried: ${attempted.join(", ")}`
        )
    }

    const metadataUrl = `${authServerUrl.replace(/\/+$/g, "")}/.well-known/oauth-authorization-server`
    const metadataResponse = await fetch(metadataUrl, {
        headers: { Accept: "application/json" }
    })
    if (!metadataResponse.ok) {
        throw new ProviderError(
            "notion-mcp",
            "MCP_DISCOVERY_FAILED",
            "Notion MCP OAuth Discovery ist fehlgeschlagen.",
            502,
            `Authorization server metadata failed (${metadataResponse.status})`
        )
    }

    const metadata = (await metadataResponse.json()) as OAuthMetadata
    if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint) {
        throw new ProviderError(
            "notion-mcp",
            "MCP_DISCOVERY_FAILED",
            "Notion MCP OAuth Discovery ist fehlgeschlagen.",
            502,
            "Missing required OAuth endpoints in metadata"
        )
    }

    return metadata
}

async function registerClient(metadata: OAuthMetadata, redirectUri: string): Promise<ClientCredentials> {
    const response = await fetch(metadata.registration_endpoint!, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
        },
        body: JSON.stringify({
            client_name: "Telegram Bot Notion MCP Client",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none"
        })
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "notion-mcp",
            "MCP_CLIENT_REGISTRATION_FAILED",
            "Notion MCP OAuth Registrierung ist fehlgeschlagen.",
            502,
            `Client registration failed (${response.status}): ${details}`
        )
    }

    const credentials = (await response.json()) as ClientCredentials
    if (!credentials.client_id) {
        throw new ProviderError(
            "notion-mcp",
            "MCP_CLIENT_REGISTRATION_FAILED",
            "Notion MCP OAuth Registrierung ist fehlgeschlagen.",
            502,
            "Missing client_id in registration response"
        )
    }

    return credentials
}

async function exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    tokenEndpoint: string,
    clientId: string,
    clientSecret: string | undefined,
    redirectUri: string
): Promise<TokenResponse> {
    const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
    })
    if (clientSecret) {
        params.append("client_secret", clientSecret)
    }

    const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
        },
        body: params.toString()
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "notion-mcp",
            "MCP_TOKEN_EXCHANGE_FAILED",
            "Notion MCP Anmeldung konnte nicht abgeschlossen werden.",
            502,
            `Token exchange failed (${response.status}): ${details}`
        )
    }

    return (await response.json()) as TokenResponse
}

async function refreshAccessToken(
    refreshToken: string,
    tokenEndpoint: string,
    clientId: string,
    clientSecret?: string
): Promise<TokenResponse> {
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId
    })
    if (clientSecret) {
        params.append("client_secret", clientSecret)
    }

    const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
        },
        body: params.toString()
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "notion-mcp",
            "MCP_TOKEN_REFRESH_FAILED",
            "Notion MCP Token konnte nicht erneuert werden.",
            502,
            `Token refresh failed (${response.status}): ${details}`
        )
    }

    return (await response.json()) as TokenResponse
}

function buildAuthorizationUrl(
    metadata: OAuthMetadata,
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    state: string
) {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "consent"
    })

    return `${metadata.authorization_endpoint}?${params.toString()}`
}

export async function isNotionMcpConnected(telegramUserId: string) {
    const token = await getStateValue<StoredNotionMcpToken>(keys.tokenKey(telegramUserId))
    return Boolean(token?.accessToken)
}

export async function createNotionMcpAuthorizationUrl(telegramUserId: string): Promise<string> {
    const serverUrl = getNotionMcpServerUrl()
    const redirectUri = buildOAuthRedirectUri(requireHonoUrl(), "notion-mcp")
    const metadata = await discoverOAuthMetadata(serverUrl)
    const credentials = await registerClient(metadata, redirectUri)

    const codeVerifier = generatePkceCodeVerifier()
    const codeChallenge = generatePkceCodeChallenge(codeVerifier)
    const stateId = arctic.generateState()

    await setStateValue<NotionMcpOAuthState>(
        keys.oauthStateKey(stateId),
        {
            telegramUserId,
            codeVerifier,
            clientId: credentials.client_id,
            clientSecret: credentials.client_secret,
            tokenEndpoint: metadata.token_endpoint
        },
        OAUTH_STATE_TTL_MS
    )

    return buildAuthorizationUrl(metadata, credentials.client_id, redirectUri, codeChallenge, stateId)
}

export async function handleNotionMcpOAuthCallback(code: string, stateId: string) {
    if (!code) throw createInvalidOAuthCallbackError("Notion MCP", "Missing OAuth code")
    if (!stateId) throw createInvalidOAuthCallbackError("Notion MCP", "Missing OAuth state")

    const oauthState = await getStateValue<NotionMcpOAuthState>(keys.oauthStateKey(stateId))
    if (!oauthState?.telegramUserId || !oauthState.codeVerifier || !oauthState.clientId || !oauthState.tokenEndpoint) {
        throw createInvalidOAuthCallbackError("Notion MCP", "Invalid or expired OAuth state")
    }

    const redirectUri = buildOAuthRedirectUri(requireHonoUrl(), "notion-mcp")
    const tokenData = await exchangeCodeForTokens(
        code,
        oauthState.codeVerifier,
        oauthState.tokenEndpoint,
        oauthState.clientId,
        oauthState.clientSecret,
        redirectUri
    )

    await setStateValue<StoredNotionMcpToken>(keys.tokenKey(oauthState.telegramUserId), {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
        scope: tokenData.scope,
        tokenEndpoint: oauthState.tokenEndpoint,
        clientId: oauthState.clientId,
        clientSecret: oauthState.clientSecret
    })
    await deleteStateValue(keys.oauthStateKey(stateId))

    return { telegramUserId: oauthState.telegramUserId }
}

export async function getValidNotionMcpAccessTokenForUser(telegramUserId: string): Promise<string> {
    const token = await getStateValue<StoredNotionMcpToken>(keys.tokenKey(telegramUserId))
    if (!token?.accessToken) {
        const authorizationUrl = await createNotionMcpAuthorizationUrl(telegramUserId)
        throw new NotionMcpAuthorizationRequiredError(authorizationUrl)
    }

    if (isTokenValid(token.expiresAt)) {
        return token.accessToken
    }

    if (!token.refreshToken) {
        const authorizationUrl = await createNotionMcpAuthorizationUrl(telegramUserId)
        throw new NotionMcpAuthorizationRequiredError(authorizationUrl)
    }

    try {
        const refreshed = await refreshAccessToken(
            token.refreshToken,
            token.tokenEndpoint,
            token.clientId,
            token.clientSecret
        )

        const updated: StoredNotionMcpToken = {
            ...token,
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token ?? token.refreshToken,
            expiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : token.expiresAt,
            scope: refreshed.scope ?? token.scope
        }
        await setStateValue<StoredNotionMcpToken>(keys.tokenKey(telegramUserId), updated)
        return updated.accessToken
    } catch {
        const authorizationUrl = await createNotionMcpAuthorizationUrl(telegramUserId)
        throw new NotionMcpAuthorizationRequiredError(authorizationUrl)
    }
}

export async function getValidNotionMcpAccessTokenIfConnected(telegramUserId: string): Promise<string | null> {
    const token = await getStateValue<StoredNotionMcpToken>(keys.tokenKey(telegramUserId))
    if (!token?.accessToken) return null

    if (isTokenValid(token.expiresAt)) {
        return token.accessToken
    }

    if (!token.refreshToken) return null

    try {
        const refreshed = await refreshAccessToken(
            token.refreshToken,
            token.tokenEndpoint,
            token.clientId,
            token.clientSecret
        )

        const updated: StoredNotionMcpToken = {
            ...token,
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token ?? token.refreshToken,
            expiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : token.expiresAt,
            scope: refreshed.scope ?? token.scope
        }

        await setStateValue<StoredNotionMcpToken>(keys.tokenKey(telegramUserId), updated)
        return updated.accessToken
    } catch {
        return null
    }
}
