import * as arctic from "arctic"
import {
    AuthorizationRequiredError,
    buildOAuthRedirectUri,
    formatArcticOAuthError,
    requireOAuthConfig,
    type OAuthState
} from "../oauth/oauthBase.js"
import {
    OAUTH_STATE_TTL_MS,
    createTelegramOAuthKeys,
    deleteStateValue,
    getStateValue,
    isTokenValid,
    setStateValue
} from "../oauth/oauthState.js"

type GithubUser = {
    login?: string
}

type GithubRepository = {
    full_name?: string
}

type GithubSearchCommitsResponse = {
    total_count?: number
    items?: Array<{
        repository?: GithubRepository
    }>
}

type GithubSearchIssuesResponse = {
    items?: Array<{
        html_url?: string
        title?: string
        number?: number
        repository_url?: string
    }>
}

const keys = createTelegramOAuthKeys("github")

type StoredGithubToken = {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
}

type GithubDailyCommitStats = {
    totalCommitsToday: number
    byRepository: Array<{ repository: string; count: number }>
}

type GithubAssignedItem = {
    number: number | null
    title: string
    url: string
    repository: string
}

export class GithubAuthorizationRequiredError extends AuthorizationRequiredError {
    constructor(authorizationUrl: string) {
        super("GitHub", "GithubAuthorizationRequiredError", authorizationUrl)
    }
}

function getGithubClient() {
    const config = requireOAuthConfig({
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        clientIdEnvName: "GITHUB_CLIENT_ID",
        clientSecretEnvName: "GITHUB_CLIENT_SECRET"
    })

    return new arctic.GitHub(
        config.clientId,
        config.clientSecret,
        buildOAuthRedirectUri(config.honoUrl, "github")
    )
}

function getExpiresAt(tokens: arctic.OAuth2Tokens) {
    try {
        const expiresAt = tokens.accessTokenExpiresAt().getTime()
        if (Number.isFinite(expiresAt)) return expiresAt
    } catch {
    }
    return undefined
}

async function saveToken(telegramUserId: string, tokens: arctic.OAuth2Tokens, previousRefreshToken?: string) {
    await setStateValue<StoredGithubToken>(keys.tokenKey(telegramUserId), {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : previousRefreshToken,
        expiresAt: getExpiresAt(tokens)
    })
}

export async function isGithubConnected(telegramUserId: string) {
    const token = await getStateValue<StoredGithubToken>(keys.tokenKey(telegramUserId))
    return Boolean(token?.accessToken)
}

export async function createGithubAuthorizationUrl(telegramUserId: string) {
    const github = getGithubClient()
    const stateId = arctic.generateState()
    await setStateValue<OAuthState>(keys.oauthStateKey(stateId), { telegramUserId }, OAUTH_STATE_TTL_MS)

    return github.createAuthorizationURL(stateId, ["read:user", "repo"]).toString()
}

export async function handleGithubOAuthCallback(code: string, stateId: string) {
    if (!code) throw new Error("Missing OAuth code")
    if (!stateId) throw new Error("Missing OAuth state")

    const oauthState = await getStateValue<OAuthState>(keys.oauthStateKey(stateId))
    if (!oauthState?.telegramUserId) {
        throw new Error("Invalid or expired OAuth state")
    }

    const github = getGithubClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await github.validateAuthorizationCode(code)
    } catch (error) {
        throw new Error(formatArcticOAuthError("GitHub", "code exchange", error))
    }

    const previousToken = await getStateValue<StoredGithubToken>(keys.tokenKey(oauthState.telegramUserId))
    await saveToken(oauthState.telegramUserId, tokens, previousToken?.refreshToken)
    await deleteStateValue(keys.oauthStateKey(stateId))
    return { telegramUserId: oauthState.telegramUserId }
}

async function refreshGithubToken(telegramUserId: string, refreshToken: string) {
    const github = getGithubClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await github.refreshAccessToken(refreshToken)
    } catch (error) {
        throw new Error(formatArcticOAuthError("GitHub", "token refresh", error))
    }

    await saveToken(telegramUserId, tokens, refreshToken)
    return tokens.accessToken()
}

async function getValidAccessTokenForUser(telegramUserId: string) {
    const token = await getStateValue<StoredGithubToken>(keys.tokenKey(telegramUserId))
    if (!token) {
        const url = await createGithubAuthorizationUrl(telegramUserId)
        throw new GithubAuthorizationRequiredError(url)
    }

    if (!token.expiresAt || isTokenValid(token.expiresAt)) {
        return token.accessToken
    }

    if (!token.refreshToken) {
        return token.accessToken
    }

    return refreshGithubToken(telegramUserId, token.refreshToken)
}

async function fetchGithubJson<T>(
    accessToken: string,
    path: string,
    extraHeaders?: Record<string, string>
): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "telegram-bot",
            ...extraHeaders
        }
    })

    if (!response.ok) {
        const details = await response.text()
        throw new Error(`GitHub API error (${response.status}): ${details}`)
    }

    return response.json() as Promise<T>
}

async function getGithubUserLogin(accessToken: string) {
    const me = await fetchGithubJson<GithubUser>(accessToken, "/user")
    if (!me.login) {
        throw new Error("GitHub user login could not be resolved")
    }
    return me.login
}

function getRepositoryFromUrl(repositoryUrl: string | undefined) {
    if (!repositoryUrl) return "unknown"
    const marker = "/repos/"
    const markerIndex = repositoryUrl.indexOf(marker)
    if (markerIndex === -1) return "unknown"
    const path = repositoryUrl.slice(markerIndex + marker.length)
    const [owner, repo] = path.split("/")
    if (!owner || !repo) return "unknown"
    return `${owner}/${repo}`
}

function getStartOfTodayIso() {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return now.toISOString()
}

export async function getGithubDailyCommitStats(telegramUserId: string): Promise<GithubDailyCommitStats> {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const login = await getGithubUserLogin(accessToken)
    const fromIso = getStartOfTodayIso()

    const query = encodeURIComponent(`author:${login} committer-date:>=${fromIso}`)
    const commits = await fetchGithubJson<GithubSearchCommitsResponse>(
        accessToken,
        `/search/commits?q=${query}&per_page=100`,
        { Accept: "application/vnd.github.cloak-preview+json" }
    )

    const repoCounts = new Map<string, number>()
    for (const item of commits.items ?? []) {
        const repo = item.repository?.full_name ?? "unknown"
        repoCounts.set(repo, (repoCounts.get(repo) ?? 0) + 1)
    }

    return {
        totalCommitsToday: commits.total_count ?? 0,
        byRepository: Array.from(repoCounts.entries())
            .map(([repository, count]) => ({ repository, count }))
            .sort((a, b) => b.count - a.count)
    }
}

export async function getGithubAssignedIssues(
    telegramUserId: string,
    limit = 10
): Promise<GithubAssignedItem[]> {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const login = await getGithubUserLogin(accessToken)
    const perPage = Math.max(1, Math.min(30, limit))
    const query = encodeURIComponent(`assignee:${login} is:open is:issue`)

    const response = await fetchGithubJson<GithubSearchIssuesResponse>(
        accessToken,
        `/search/issues?q=${query}&sort=updated&order=desc&per_page=${perPage}`
    )

    return (response.items ?? []).map((item) => ({
        number: item.number ?? null,
        title: item.title ?? "Ohne Titel",
        url: item.html_url ?? "",
        repository: getRepositoryFromUrl(item.repository_url)
    }))
}

export async function getGithubAssignedPrs(
    telegramUserId: string,
    limit = 10
): Promise<GithubAssignedItem[]> {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const login = await getGithubUserLogin(accessToken)
    const perPage = Math.max(1, Math.min(30, limit))
    const query = encodeURIComponent(`assignee:${login} is:open is:pr`)

    const response = await fetchGithubJson<GithubSearchIssuesResponse>(
        accessToken,
        `/search/issues?q=${query}&sort=updated&order=desc&per_page=${perPage}`
    )

    return (response.items ?? []).map((item) => ({
        number: item.number ?? null,
        title: item.title ?? "Ohne Titel",
        url: item.html_url ?? "",
        repository: getRepositoryFromUrl(item.repository_url)
    }))
}
