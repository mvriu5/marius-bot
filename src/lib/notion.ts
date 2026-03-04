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

const AGENT_NOTION_MAX_PAGES = 20
const AGENT_NOTION_MAX_PAGE_EXCERPT_CHARS = 500
const AGENT_NOTION_MAX_CONTEXT_CHARS = 6000
const AGENT_NOTION_SEARCH_MAX_RESULTS = 6
const AGENT_NOTION_QUERY_CONTEXT_ITEMS = 5

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

        return truncate(lines.join("\n"), 700)
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

async function getValidAccessTokenForUser(telegramUserId: string) {
    const token = await getStateValue<StoredNotionToken>(keys.tokenKey(telegramUserId))
    if (!token?.accessToken) {
        const url = await createNotionAuthorizationUrl(telegramUserId)
        throw new NotionAuthorizationRequiredError(url)
    }
    return token.accessToken
}

async function findNotionContext(client: Client, query: string): Promise<NotionContextItem[]> {
    let searchResponse: Awaited<ReturnType<Client["search"]>>
    try {
        searchResponse = await client.search({
            query: query.trim(),
            page_size: AGENT_NOTION_SEARCH_MAX_RESULTS
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

    const results = searchResponse.results
        .filter((item) => isFullPageOrDataSource(item))
        .slice(0, AGENT_NOTION_QUERY_CONTEXT_ITEMS)

    return Promise.all(
        results.map(async (item): Promise<NotionContextItem> => {
            const title = getItemTitle(item)
            const text = item.object === "page"
                ? await fetchPageExcerpt(client, item.id)
                : "Datenbank-Eintrag gefunden."

            return {
                title,
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

export async function getNotionKnowledgeForAgent(telegramUserId: string, query: string) {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return null

    const connected = await isNotionConnected(telegramUserId)
    if (!connected) return null

    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const notion = new Client({ auth: accessToken })
    let contextItems = await findNotionContext(notion, normalizedQuery)

    if (contextItems.length === 0) {
        const pages = await listNotionPagesForAgent(notion)
        if (pages.length === 0) return "Keine Notion-Seiten gefunden."

        contextItems = await Promise.all(
            pages.slice(0, AGENT_NOTION_MAX_PAGES).map(async (page) => {
                const excerpt = await fetchPageExcerpt(notion, page.id)
                return {
                    title: page.title,
                    url: page.url,
                    text: truncate(excerpt || "Kein auslesbarer Textinhalt vorhanden.", AGENT_NOTION_MAX_PAGE_EXCERPT_CHARS)
                }
            })
        )
    }

    return createNotionAgentContext(contextItems, normalizedQuery)
}
