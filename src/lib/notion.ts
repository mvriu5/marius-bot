import * as arctic from "arctic"
import { Client, isFullPageOrDataSource } from "@notionhq/client"
import {
    AuthorizationRequiredError,
    buildOAuthRedirectUri,
    createInvalidOAuthCallbackError,
    formatArcticOAuthError,
    requireOAuthConfig,
    type OAuthState
} from "../oauth/oauthBase.js"
import { ProviderError } from "../errors/appError.js"
import {
    OAUTH_STATE_TTL_MS,
    createTelegramOAuthKeys,
    deleteStateValue,
    getStateValue,
    setStateValue
} from "../oauth/oauthState.js"

const keys = createTelegramOAuthKeys("notion")

type StoredNotionToken = {
    accessToken: string
}

type NotionContextItem = {
    title: string
    url: string
    text: string
}

const AGENT_NOTION_MAX_PAGE_EXCERPT_CHARS = 500
const AGENT_NOTION_MAX_CONTEXT_CHARS = 40000
const AGENT_NOTION_MAX_PAGE_CONTENT_CHARS = 12000
const AGENT_NOTION_MAX_PAGE_CONTENT_DEPTH = 3
const AGENT_NOTION_SEARCH_TOP_K = 80
const AGENT_NOTION_RERANK_TOP_N = 60
const AGENT_NOTION_QUERY_CONTEXT_ITEMS = 50
const AGENT_NOTION_SCORE_THRESHOLD = 0.65
const AGENT_NOTION_MMR_LAMBDA = 0.75

type NotionPageCandidate = {
    id: string
    title: string
    url: string
}

export type AgentNotionSearchResult = {
    pageId: string
    title: string
    url: string
    excerpt: string
    score: number
}

export type AgentNotionPageResult = {
    pageId: string
    title: string
    url: string
    text: string
    truncated: boolean
}

export class NotionAuthorizationRequiredError extends AuthorizationRequiredError {
    constructor(authorizationUrl: string) {
        super("Notion", "NotionAuthorizationRequiredError", authorizationUrl)
    }
}

function getNotionOauthClient() {
    const config = requireOAuthConfig({
        clientId: process.env.NOTION_CLIENT_ID!,
        clientSecret: process.env.NOTION_CLIENT_SECRET!,
        clientIdEnvName: "NOTION_CLIENT_ID",
        clientSecretEnvName: "NOTION_CLIENT_SECRET"
    })

    return new arctic.Notion(
        config.clientId,
        config.clientSecret,
        buildOAuthRedirectUri(config.honoUrl, "notion")
    )
}

function extractPlainText(parts: Array<{ plain_text: string }>) {
    return parts.map((part) => part.plain_text).join("").trim()
}

function getItemTitle(item: Parameters<typeof isFullPageOrDataSource>[0]): string {
    if (!isFullPageOrDataSource(item)) {
        return "Notion Seite"
    }

    if (item.object === "page") {
        const titleProp = Object.values(item.properties).find((prop) => prop.type === "title")
        if (titleProp?.type === "title") {
            const text = extractPlainText(titleProp.title)
            if (text) return text
        }
        return "Notion Seite"
    }

    const title = extractPlainText(item.title)
    if (title) return title
    return "Notion Datenquelle"
}

function blockToText(
    block: Awaited<ReturnType<Client["blocks"]["children"]["list"]>>["results"][number]
) {
    if (!("type" in block)) return ""
    const type = block.type

    const richTextTypes = new Set([
        "paragraph",
        "heading_1",
        "heading_2",
        "heading_3",
        "bulleted_list_item",
        "numbered_list_item",
        "to_do",
        "quote",
        "callout",
        "toggle"
    ])
    if (!richTextTypes.has(type)) return ""

    const typed = block as unknown as Record<string, { rich_text?: Array<{ plain_text: string }> }>
    return extractPlainText(typed[type]?.rich_text ?? [])
}

function truncate(input: string, maxChars: number) {
    if (input.length <= maxChars) return input
    return `${input.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

async function fetchPageExcerpt(client: Client, pageId: string) {
    try {
        const blocks = await client.blocks.children.list({
            block_id: pageId,
            page_size: 30
        })

        const lines = blocks.results
            .map((block) => blockToText(block))
            .filter(Boolean)
            .slice(0, 8)

        return truncate(lines.join("\n"), AGENT_NOTION_MAX_PAGE_EXCERPT_CHARS)
    } catch (error) {
        const details = error instanceof Error ? error.message : String(error)
        throw new ProviderError(
            "notion",
            "NOTION_API_ERROR",
            "Notion Daten konnten nicht geladen werden.",
            502,
            `Notion blocks read failed: ${details}`,
            error
        )
    }
}

async function fetchBlockTextTree(
    client: Client,
    blockId: string,
    maxChars: number,
    depth = 0
): Promise<{ text: string; truncated: boolean }> {
    let text = ""
    let truncated = false
    let nextCursor: string | undefined

    const appendLine = (line: string) => {
        const normalized = line.trim()
        if (!normalized) return

        const candidate = text ? `${text}\n${normalized}` : normalized
        if (candidate.length > maxChars) {
            text = candidate.slice(0, maxChars).trimEnd()
            truncated = true
            return
        }

        text = candidate
    }

    do {
        let response: Awaited<ReturnType<Client["blocks"]["children"]["list"]>>
        try {
            response = await client.blocks.children.list({
                block_id: blockId,
                page_size: 100,
                ...(nextCursor ? { start_cursor: nextCursor } : {})
            })
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            throw new ProviderError(
                "notion",
                "NOTION_API_ERROR",
                "Notion Daten konnten nicht geladen werden.",
                502,
                `Notion blocks read failed: ${details}`,
                error
            )
        }

        for (const block of response.results) {
            if (truncated) break

            appendLine(blockToText(block))
            if (truncated) break

            const hasChildren = "has_children" in block && Boolean(block.has_children)
            const childId = "id" in block && typeof block.id === "string" ? block.id : null
            if (!hasChildren || !childId || depth >= AGENT_NOTION_MAX_PAGE_CONTENT_DEPTH - 1) {
                continue
            }

            const remainingChars = maxChars - text.length
            if (remainingChars <= 0) {
                truncated = true
                break
            }

            const nested = await fetchBlockTextTree(client, childId, remainingChars, depth + 1)
            appendLine(nested.text)
            if (nested.truncated) {
                truncated = true
                break
            }
        }

        if (truncated || !response.has_more) break
        nextCursor = response.next_cursor ?? undefined
    } while (nextCursor)

    return { text, truncated }
}

function tokenize(input: string): string[] {
    return input
        .toLowerCase()
        .split(/[^a-z0-9äöüß]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
}

function tokenOverlap(left: string[], right: string[]) {
    if (left.length === 0 || right.length === 0) return 0
    const rightSet = new Set(right)
    let overlapCount = 0
    for (const token of left) {
        if (rightSet.has(token)) overlapCount += 1
    }
    return overlapCount / left.length
}

function jaccardSimilarity(left: string[], right: string[]) {
    if (left.length === 0 || right.length === 0) return 0
    const leftSet = new Set(left)
    const rightSet = new Set(right)
    const union = new Set([...leftSet, ...rightSet])
    let intersection = 0
    for (const token of leftSet) {
        if (rightSet.has(token)) intersection += 1
    }
    return union.size === 0 ? 0 : intersection / union.size
}

function scoreCandidate(candidate: NotionPageCandidate, normalizedQuery: string) {
    const queryTokens = tokenize(normalizedQuery)
    const titleTokens = tokenize(candidate.title)
    const urlTokens = tokenize(candidate.url)

    const titleCoverage = tokenOverlap(queryTokens, titleTokens)
    const urlCoverage = tokenOverlap(queryTokens, urlTokens)
    const titleContainsFullQuery = candidate.title.toLowerCase().includes(normalizedQuery.toLowerCase())

    let score = 0
    if (titleContainsFullQuery) score += 0.45
    score += titleCoverage * 0.45
    score += urlCoverage * 0.1

    return Math.min(1, Math.max(0, score))
}

function pickDiverseCandidates(
    rankedCandidates: Array<NotionPageCandidate & { score: number }>,
    maxItems: number
) {
    const selected: Array<NotionPageCandidate & { score: number }> = []

    for (const candidate of rankedCandidates) {
        if (selected.length >= maxItems) break

        if (selected.length === 0) {
            selected.push(candidate)
            continue
        }

        const candidateTokens = tokenize(candidate.title)
        const maxSimilarity = selected.reduce((maxValue, current) => {
            const similarity = jaccardSimilarity(candidateTokens, tokenize(current.title))
            return Math.max(maxValue, similarity)
        }, 0)

        const mmrScore =
            AGENT_NOTION_MMR_LAMBDA * candidate.score - (1 - AGENT_NOTION_MMR_LAMBDA) * maxSimilarity
        if (mmrScore > 0 || selected.length < Math.max(1, Math.floor(maxItems / 2))) {
            selected.push(candidate)
        }
    }

    if (selected.length > 0) return selected
    return rankedCandidates.slice(0, maxItems)
}

async function searchNotionPages(
    client: Client,
    options: {
        query?: string
        sortByRecent?: boolean
        limit: number
    }
): Promise<NotionPageCandidate[]> {
    const { query, sortByRecent, limit } = options
    const pageSize = Math.min(100, Math.max(1, limit))
    const pages: NotionPageCandidate[] = []
    let nextCursor: string | undefined

    do {
        let searchResponse: Awaited<ReturnType<Client["search"]>>
        try {
            searchResponse = await client.search({
                filter: { value: "page", property: "object" },
                ...(query ? { query } : {}),
                ...(sortByRecent
                    ? { sort: { direction: "descending", timestamp: "last_edited_time" as const } }
                    : {}),
                page_size: Math.min(pageSize, limit - pages.length),
                ...(nextCursor ? { start_cursor: nextCursor } : {})
            })
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            throw new ProviderError(
                "notion",
                "NOTION_API_ERROR",
                "Notion Daten konnten nicht geladen werden.",
                502,
                `Notion search failed: ${details}`,
                error
            )
        }

        const batch = searchResponse.results
            .filter((item) => isFullPageOrDataSource(item) && item.object === "page")
            .map((item) => ({
                id: item.id,
                title: getItemTitle(item),
                url: item.url
            }))
        pages.push(...batch)

        if (!searchResponse.has_more || pages.length >= limit) break
        nextCursor = searchResponse.next_cursor ?? undefined
    } while (nextCursor)

    return pages.slice(0, limit)
}

async function fetchAllNotionPageCandidates(client: Client): Promise<NotionPageCandidate[]> {
    const pages: NotionPageCandidate[] = []
    let nextCursor: string | undefined

    do {
        let searchResponse: Awaited<ReturnType<Client["search"]>>
        try {
            searchResponse = await client.search({
                filter: { value: "page", property: "object" },
                sort: { direction: "descending", timestamp: "last_edited_time" as const },
                page_size: 100,
                ...(nextCursor ? { start_cursor: nextCursor } : {})
            })
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            throw new ProviderError(
                "notion",
                "NOTION_API_ERROR",
                "Notion Daten konnten nicht geladen werden.",
                502,
                `Notion search failed: ${details}`,
                error
            )
        }

        const batch = searchResponse.results
            .filter((item) => isFullPageOrDataSource(item) && item.object === "page")
            .map((item) => ({
                id: item.id,
                title: getItemTitle(item),
                url: item.url
            }))
        pages.push(...batch)

        if (!searchResponse.has_more) break
        nextCursor = searchResponse.next_cursor ?? undefined
    } while (nextCursor)

    return pages
}

async function getValidAccessTokenForUser(telegramUserId: string) {
    const token = await getStateValue<StoredNotionToken>(keys.tokenKey(telegramUserId))
    if (!token?.accessToken) {
        const url = await createNotionAuthorizationUrl(telegramUserId)
        throw new NotionAuthorizationRequiredError(url)
    }
    return token.accessToken
}

async function findNotionContext(client: Client, query: string): Promise<NotionContextItem[]> {
    const normalizedQuery = query.trim()

    const [queryCandidates, allCandidates] = await Promise.all([
        searchNotionPages(client, {
            query: normalizedQuery,
            limit: AGENT_NOTION_SEARCH_TOP_K
        }),
        fetchAllNotionPageCandidates(client)
    ])

    const deduplicated = new Map<string, NotionPageCandidate>()
    for (const candidate of [...queryCandidates, ...allCandidates]) {
        if (!deduplicated.has(candidate.id)) {
            deduplicated.set(candidate.id, candidate)
        }
    }

    const ranked = [...deduplicated.values()]
        .map((candidate) => ({
            ...candidate,
            score: scoreCandidate(candidate, normalizedQuery)
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, AGENT_NOTION_RERANK_TOP_N)

    const thresholdMatches = ranked.filter((candidate) => candidate.score >= AGENT_NOTION_SCORE_THRESHOLD)
    const rankedPool = thresholdMatches.length > 0 ? thresholdMatches : ranked
    const selected = pickDiverseCandidates(rankedPool, AGENT_NOTION_QUERY_CONTEXT_ITEMS)

    return Promise.all(
        selected.map(async (item): Promise<NotionContextItem> => {
            const text = await fetchPageExcerpt(client, item.id)
            return {
                title: item.title,
                url: item.url,
                text: text || "Kein auslesbarer Textinhalt vorhanden."
            }
        })
    )
}

function createNotionAgentContext(items: NotionContextItem[], normalizedQuery: string) {
    const lines: string[] = ["Notion-Wissenskontext (relevant zur User-Frage):"]
    let currentLength = lines[0].length

    for (const [index, item] of items.entries()) {
        const sectionLines = [
            `Treffer ${index + 1}: ${item.title}`,
            item.url ? `URL: ${item.url}` : "",
            `Inhalt: ${item.text}`,
            ""
        ].filter(Boolean)
        const sectionText = sectionLines.join("\n")
        const additionalLength = sectionText.length + 1

        if (currentLength + additionalLength > AGENT_NOTION_MAX_CONTEXT_CHARS) {
            break
        }

        lines.push(sectionText)
        currentLength += additionalLength
    }

    const queryLine = `Frage des Users: ${normalizedQuery}`
    if (currentLength + queryLine.length + 1 <= AGENT_NOTION_MAX_CONTEXT_CHARS) {
        lines.push(queryLine)
    }

    return lines.join("\n").trim()
}

export async function isNotionConnected(telegramUserId: string) {
    const token = await getStateValue<StoredNotionToken>(keys.tokenKey(telegramUserId))
    return Boolean(token?.accessToken)
}

export async function createNotionAuthorizationUrl(telegramUserId: string) {
    const notion = getNotionOauthClient()
    const stateId = arctic.generateState()

    await setStateValue<OAuthState>(
        keys.oauthStateKey(stateId),
        { telegramUserId },
        OAUTH_STATE_TTL_MS
    )

    return notion.createAuthorizationURL(stateId).toString()
}

export async function handleNotionOAuthCallback(code: string, stateId: string) {
    if (!code) throw createInvalidOAuthCallbackError("Notion", "Missing OAuth code")
    if (!stateId) throw createInvalidOAuthCallbackError("Notion", "Missing OAuth state")

    const oauthState = await getStateValue<OAuthState>(keys.oauthStateKey(stateId))
    if (!oauthState?.telegramUserId) {
        throw createInvalidOAuthCallbackError("Notion", "Invalid or expired OAuth state")
    }

    const notion = getNotionOauthClient()
    let tokens: arctic.OAuth2Tokens
    try {
        tokens = await notion.validateAuthorizationCode(code)
    } catch (error) {
        throw new ProviderError(
            "notion",
            "NOTION_OAUTH_CODE_EXCHANGE_FAILED",
            "Notion Anmeldung konnte nicht abgeschlossen werden.",
            502,
            formatArcticOAuthError("Notion", "code exchange", error),
            error
        )
    }

    await setStateValue<StoredNotionToken>(keys.tokenKey(oauthState.telegramUserId), {
        accessToken: tokens.accessToken()
    })
    await deleteStateValue(keys.oauthStateKey(stateId))

    return { telegramUserId: oauthState.telegramUserId }
}

export type NotionPageItem = {
    title: string
    url: string
}

export async function getNotionPages(telegramUserId: string): Promise<NotionPageItem[]> {
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const notion = new Client({ auth: accessToken })

    const allPages: NotionPageItem[] = []
    let nextCursor: string | undefined = undefined

    do {
        let searchResponse: Awaited<ReturnType<Client["search"]>>
        try {
            searchResponse = await notion.search({
                filter: { value: "page", property: "object" },
                page_size: 100,
                ...(nextCursor ? { start_cursor: nextCursor } : {})
            })
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            throw new ProviderError(
                "notion",
                "NOTION_API_ERROR",
                "Notion Seiten konnten nicht geladen werden.",
                502,
                `Notion search failed: ${details}`,
                error
            )
        }

        const pages = searchResponse.results
            .filter((item) => isFullPageOrDataSource(item))
            .map((item) => ({
                title: getItemTitle(item),
                url: item.url
            }))
        allPages.push(...pages)

        nextCursor = searchResponse.has_more ? (searchResponse.next_cursor ?? undefined) : undefined
    } while (nextCursor)

    return allPages
}

export async function searchNotionForAgent(
    telegramUserId: string,
    query: string,
    limit = 5
): Promise<AgentNotionSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    const normalizedLimit = Math.min(8, Math.max(1, limit))
    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const notion = new Client({ auth: accessToken })

    const candidates = await searchNotionPages(notion, {
        query: normalizedQuery,
        sortByRecent: true,
        limit: Math.max(normalizedLimit * 6, 20)
    })

    if (candidates.length === 0) return []

    const ranked = candidates
        .map((candidate) => ({
            ...candidate,
            score: scoreCandidate(candidate, normalizedQuery)
        }))
        .sort((left, right) => right.score - left.score)

    const selected = pickDiverseCandidates(ranked, normalizedLimit)
    const withExcerpt = await Promise.all(
        selected.map(async (candidate) => {
            const excerpt = await fetchPageExcerpt(notion, candidate.id)
            return {
                pageId: candidate.id,
                title: candidate.title,
                url: candidate.url,
                excerpt: excerpt || "Kein auslesbarer Textinhalt vorhanden.",
                score: Math.round(candidate.score * 1000) / 1000
            }
        })
    )

    return withExcerpt
}

export async function getNotionPageForAgent(
    telegramUserId: string,
    pageId: string,
    maxChars = 6000
): Promise<AgentNotionPageResult> {
    const normalizedPageId = pageId.trim()
    if (!normalizedPageId) {
        throw new ProviderError(
            "notion",
            "NOTION_INVALID_PAGE_ID",
            "Die Notion-Seite konnte nicht geladen werden.",
            400,
            "Notion page id is empty."
        )
    }

    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const notion = new Client({ auth: accessToken })
    const safeMaxChars = Math.min(
        AGENT_NOTION_MAX_PAGE_CONTENT_CHARS,
        Math.max(800, Math.floor(maxChars))
    )

    let page: Awaited<ReturnType<Client["pages"]["retrieve"]>>
    try {
        page = await notion.pages.retrieve({ page_id: normalizedPageId })
    } catch (error) {
        const details = error instanceof Error ? error.message : String(error)
        throw new ProviderError(
            "notion",
            "NOTION_API_ERROR",
            "Notion Daten konnten nicht geladen werden.",
            502,
            `Notion page read failed: ${details}`,
            error
        )
    }

    const title =
        isFullPageOrDataSource(page) && page.object === "page"
            ? getItemTitle(page)
            : "Notion Seite"
    const url =
        "url" in page && typeof page.url === "string"
            ? page.url
            : ""

    const content = await fetchBlockTextTree(notion, normalizedPageId, safeMaxChars)
    return {
        pageId: normalizedPageId,
        title,
        url,
        text: content.text || "Kein auslesbarer Textinhalt vorhanden.",
        truncated: content.truncated
    }
}

export async function getNotionKnowledgeForAgent(telegramUserId: string, query: string) {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return null

    const connected = await isNotionConnected(telegramUserId)
    if (!connected) return null

    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const notion = new Client({ auth: accessToken })
    const contextItems = await findNotionContext(notion, normalizedQuery)
    if (contextItems.length === 0) return "Keine Notion-Seiten gefunden."

    return createNotionAgentContext(contextItems, normalizedQuery)
}
