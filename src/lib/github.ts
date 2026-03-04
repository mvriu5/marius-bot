import * as arctic from "arctic"
import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
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

type GithubCopilotTaskInfo = {
    issueNumber: number
    issueUrl: string
}

type TimelineCrossReferencedEvent = {
    event: string
    source?: {
        issue?: {
            number?: number
            pull_request?: { url?: string }
        }
    }
}

type GithubCopilotPrInfo = {
    number: number
    url: string
    title: string
    body: string
    headSha: string
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

function getOctokit(accessToken: string) {
    return new Octokit({
        auth: accessToken,
        userAgent: "telegram-bot"
    })
}

function getGraphqlWithAuth(accessToken: string) {
    return graphql.defaults({
        headers: {
            authorization: `token ${accessToken}`
        }
    })
}

async function getGithubUserLogin(accessToken: string) {
    const octokit = getOctokit(accessToken)
    const { data: me } = await octokit.rest.users.getAuthenticated()
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
    const octokit = getOctokit(accessToken)
    const login = await getGithubUserLogin(accessToken)
    const fromIso = getStartOfTodayIso()

    const { data: commits } = await octokit.rest.search.commits({
        q: `author:${login} committer-date:>=${fromIso}`,
        per_page: 100,
        headers: { accept: "application/vnd.github.cloak-preview+json" }
    })

    const repoCounts = new Map<string, number>()
    for (const item of commits.items) {
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
    const octokit = getOctokit(accessToken)
    const login = await getGithubUserLogin(accessToken)
    const perPage = Math.max(1, Math.min(30, limit))

    const { data: response } = await octokit.rest.search.issuesAndPullRequests({
        q: `assignee:${login} is:open is:issue`,
        sort: "updated",
        order: "desc",
        per_page: perPage
    })

    return response.items.map((item) => ({
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
    const octokit = getOctokit(accessToken)
    const login = await getGithubUserLogin(accessToken)
    const perPage = Math.max(1, Math.min(30, limit))

    const { data: response } = await octokit.rest.search.issuesAndPullRequests({
        q: `assignee:${login} is:open is:pr`,
        sort: "updated",
        order: "desc",
        per_page: perPage
    })

    return response.items.map((item) => ({
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
    const octokit = getOctokit(accessToken)
    const perPage = Math.max(1, Math.min(50, limit * 3))

    const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: "updated",
        direction: "desc",
        affiliation: "owner,collaborator,organization_member",
        per_page: perPage
    })

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
    const octokit = getOctokit(accessToken)
    const { owner, repo } = splitRepoFullName(repoFullName)
    const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo })
    const baseBranch = repoInfo.default_branch || "main"
    const title = `Copilot task: ${prompt.trim().slice(0, 80) || "Task"}`
    const body = [
        "Requested via Telegram bot.",
        "",
        "Task:",
        prompt.trim()
    ].join("\n")

    const { data: issue } = await octokit.request("POST /repos/{owner}/{repo}/issues", {
        owner,
        repo,
        title,
        body,
        assignees: ["copilot-swe-agent[bot]"],
        agent_assignment: {
            target_repo: repoFullName,
            base_branch: baseBranch
        }
    })

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
    const octokit = getOctokit(accessToken)
    const { owner, repo } = splitRepoFullName(repoFullName)
    const { data: timeline } = await octokit.rest.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100
    })

    const prNumber = timeline
        .filter((event) => event.event === "cross-referenced")
        .map((event) => (event as TimelineCrossReferencedEvent).source?.issue)
        .find((issue) => Boolean(issue?.pull_request?.url))
        ?.number

    if (!prNumber) return null

    const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })
    const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 20 })

    if (!pr.number || !pr.html_url || !pr.head?.sha) return null

    return {
        number: pr.number,
        url: pr.html_url,
        title: pr.title || "Ohne Titel",
        body: pr.body || "",
        headSha: pr.head.sha,
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
    const octokit = getOctokit(accessToken)
    const { owner, repo } = splitRepoFullName(repoFullName)

    const tryMerge = async () => {
        try {
            await octokit.rest.pulls.merge({ owner, repo, pull_number: prNumber, merge_method: "squash" })
            return { ok: true, status: 200, details: "" }
        } catch (error) {
            const err = error as { status?: number; message?: string }
            return { ok: false, status: err.status ?? 500, details: err.message ?? String(error) }
        }
    }

    const setReadyForReview = async () => {
        const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })

        if (!pr.node_id) {
            throw new ProviderError(
                "github",
                "GITHUB_PR_READY_FOR_REVIEW_FAILED",
                "Pull Request konnte nicht auf 'Ready for review' gesetzt werden.",
                502,
                "PR node_id missing in response"
            )
        }

        try {
            await getGraphqlWithAuth(accessToken)<{
                markPullRequestReadyForReview: {
                    pullRequest: { isDraft: boolean }
                }
            }>(
                `mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
                    markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
                        pullRequest {
                            isDraft
                        }
                    }
                }`,
                { pullRequestId: pr.node_id }
            )
        } catch (error) {
            throw new ProviderError(
                "github",
                "GITHUB_PR_READY_FOR_REVIEW_FAILED",
                "Pull Request konnte nicht auf 'Ready for review' gesetzt werden.",
                502,
                error instanceof Error ? error.message : String(error),
                error
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
    const octokit = getOctokit(accessToken)
    const { owner, repo } = splitRepoFullName(repoFullName)
    await octokit.rest.pulls.update({ owner, repo, pull_number: prNumber, state: "closed" })
}
