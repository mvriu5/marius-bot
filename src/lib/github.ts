import * as arctic from "arctic"
import {
    AuthorizationRequiredError,
    buildOAuthRedirectUri,
    createInvalidOAuthCallbackError,
    formatArcticOAuthError,
    requireOAuthConfig,
    type OAuthState
} from "../oauth/oauthBase.js"
import { ProviderError, UserError } from "../errors/appError.js"
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

type GithubUserRepo = {
    full_name?: string
    default_branch?: string
    permissions?: {
        push?: boolean
    }
}

type GithubIssueResponse = {
    number?: number
    html_url?: string
}

type GithubTimelineCrossReferenceEvent = {
    event?: string
    source?: {
        issue?: {
            number?: number
            html_url?: string
            pull_request?: {
                url?: string
                html_url?: string
            }
        }
    }
}

type GithubPullRequestResponse = {
    number?: number
    html_url?: string
    title?: string
    body?: string
    draft?: boolean
    additions?: number
    deletions?: number
    changed_files?: number
}

type GithubPullRequestFile = {
    filename?: string
}

type GithubCopilotTaskInfo = {
    issueNumber: number
    issueUrl: string
}

type GithubCopilotPrInfo = {
    number: number
    url: string
    title: string
    body: string
    isDraft: boolean
    additions: number
    deletions: number
    changedFiles: number
    topFiles: string[]
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
    if (!code) throw createInvalidOAuthCallbackError("GitHub", "Missing OAuth code")
    if (!stateId) throw createInvalidOAuthCallbackError("GitHub", "Missing OAuth state")

    const oauthState = await getStateValue<OAuthState>(keys.oauthStateKey(stateId))
    if (!oauthState?.telegramUserId) {
        throw createInvalidOAuthCallbackError("GitHub", "Invalid or expired OAuth state")
    }

    const github = getGithubClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await github.validateAuthorizationCode(code)
    } catch (error) {
        throw new ProviderError(
            "github",
            "GITHUB_OAUTH_CODE_EXCHANGE_FAILED",
            "GitHub Anmeldung konnte nicht abgeschlossen werden.",
            502,
            formatArcticOAuthError("GitHub", "code exchange", error),
            error
        )
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
        throw new ProviderError(
            "github",
            "GITHUB_TOKEN_REFRESH_FAILED",
            "GitHub Token konnte nicht erneuert werden.",
            502,
            formatArcticOAuthError("GitHub", "token refresh", error),
            error
        )
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
        throw new ProviderError(
            "github",
            "GITHUB_API_ERROR",
            "GitHub Daten konnten nicht geladen werden.",
            502,
            `GitHub API error (${response.status}): ${details}`
        )
    }

    return response.json() as Promise<T>
}

async function getGithubUserLogin(accessToken: string) {
    const me = await fetchGithubJson<GithubUser>(accessToken, "/user")
    if (!me.login) {
        throw new UserError(
            "GITHUB_USER_LOGIN_MISSING",
            "GitHub Benutzer konnte nicht ermittelt werden.",
            "GitHub user login could not be resolved"
        )
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

function splitRepoFullName(repoFullName: string) {
    const [owner, repo] = repoFullName.split("/")
    if (!owner || !repo) {
        throw new UserError(
            "GITHUB_REPOSITORY_INVALID",
            "Repository muss im Format owner/repo angegeben werden."
        )
    }
    return { owner, repo }
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

export async function listGithubWritableRepositories(
    telegramUserId: string,
    limit = 8
): Promise<Array<{ fullName: string; defaultBranch: string }>> {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const perPage = Math.max(1, Math.min(50, limit * 3))
    const repos = await fetchGithubJson<GithubUserRepo[]>(
        accessToken,
        `/user/repos?sort=updated&direction=desc&affiliation=owner,collaborator,organization_member&per_page=${perPage}`
    )

    return repos
        .filter((repo) => repo.permissions?.push && repo.full_name)
        .slice(0, limit)
        .map((repo) => ({
            fullName: repo.full_name as string,
            defaultBranch: repo.default_branch || "main"
        }))
}

export async function createCopilotIssueTask(
    telegramUserId: string,
    repoFullName: string,
    prompt: string
): Promise<GithubCopilotTaskInfo> {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const { owner, repo } = splitRepoFullName(repoFullName)
    const repoInfo = await fetchGithubJson<GithubUserRepo>(accessToken, `/repos/${owner}/${repo}`)
    const baseBranch = repoInfo.default_branch || "main"
    const title = `Copilot task: ${prompt.trim().slice(0, 80) || "Task"}`
    const body = [
        "Requested via Telegram bot.",
        "",
        "Task:",
        prompt.trim()
    ].join("\n")

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "telegram-bot",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            title,
            body,
            assignees: ["copilot-swe-agent[bot]"],
            agent_assignment: {
                target_repo: repoFullName,
                base_branch: baseBranch
            }
        })
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "github",
            "GITHUB_COPILOT_TASK_CREATE_FAILED",
            "Copilot Task konnte nicht gestartet werden.",
            502,
            `Copilot issue creation failed (${response.status}): ${details}`
        )
    }

    const issue = await response.json() as GithubIssueResponse
    if (!issue.number || !issue.html_url) {
        throw new ProviderError(
            "github",
            "GITHUB_COPILOT_TASK_INVALID_RESPONSE",
            "Copilot Task konnte nicht gestartet werden.",
            502,
            "Issue response missing number or html_url"
        )
    }

    return {
        issueNumber: issue.number,
        issueUrl: issue.html_url
    }
}

export async function findCopilotPrForIssue(
    telegramUserId: string,
    repoFullName: string,
    issueNumber: number
): Promise<GithubCopilotPrInfo | null> {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const { owner, repo } = splitRepoFullName(repoFullName)
    const timeline = await fetchGithubJson<GithubTimelineCrossReferenceEvent[]>(
        accessToken,
        `/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100`
    )

    const prNumber = timeline
        .filter((event) => event.event === "cross-referenced")
        .map((event) => event.source?.issue)
        .find((issue) => Boolean(issue?.pull_request?.url))
        ?.number

    if (!prNumber) return null

    const pr = await fetchGithubJson<GithubPullRequestResponse>(
        accessToken,
        `/repos/${owner}/${repo}/pulls/${prNumber}`
    )

    const files = await fetchGithubJson<GithubPullRequestFile[]>(
        accessToken,
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=20`
    )

    if (!pr.number || !pr.html_url) return null

    return {
        number: pr.number,
        url: pr.html_url,
        title: pr.title || "Ohne Titel",
        body: pr.body || "",
        isDraft: Boolean(pr.draft),
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changedFiles: pr.changed_files ?? files.length,
        topFiles: files.map((file) => file.filename).filter((name): name is string => Boolean(name)).slice(0, 5)
    }
}

export async function mergePullRequest(
    telegramUserId: string,
    repoFullName: string,
    prNumber: number
) {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const { owner, repo } = splitRepoFullName(repoFullName)
    const baseHeaders = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "telegram-bot",
        "Content-Type": "application/json"
    }

    const tryMerge = async () => {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
            method: "PUT",
            headers: baseHeaders,
            body: JSON.stringify({
                merge_method: "squash"
            })
        })
        return {
            ok: response.ok,
            status: response.status,
            details: await response.text()
        }
    }

    const setReadyForReview = async () => {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/ready_for_review`, {
            method: "POST",
            headers: baseHeaders
        })

        if (!response.ok && response.status !== 422) {
            const details = await response.text()
            throw new ProviderError(
                "github",
                "GITHUB_PR_READY_FOR_REVIEW_FAILED",
                "Pull Request konnte nicht auf 'Ready for review' gesetzt werden.",
                502,
                `PR ready_for_review failed (${response.status}): ${details}`
            )
        }
    }

    const firstMerge = await tryMerge()
    if (firstMerge.ok) return

    if (firstMerge.status === 405 && /still a draft/i.test(firstMerge.details)) {
        await setReadyForReview()
        const secondMerge = await tryMerge()
        if (secondMerge.ok) return

        throw new ProviderError(
            "github",
            "GITHUB_PR_MERGE_FAILED",
            "Pull Request konnte nicht gemerged werden.",
            502,
            `PR merge failed after ready_for_review (${secondMerge.status}): ${secondMerge.details}`
        )
    }

    throw new ProviderError(
        "github",
        "GITHUB_PR_MERGE_FAILED",
        "Pull Request konnte nicht gemerged werden.",
        502,
        `PR merge failed (${firstMerge.status}): ${firstMerge.details}`
    )
}

export async function closePullRequest(
    telegramUserId: string,
    repoFullName: string,
    prNumber: number
) {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const { owner, repo } = splitRepoFullName(repoFullName)
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "telegram-bot",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            state: "closed"
        })
    })

    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "github",
            "GITHUB_PR_CLOSE_FAILED",
            "Pull Request konnte nicht geschlossen werden.",
            502,
            `PR close failed (${response.status}): ${details}`
        )
    }
}
