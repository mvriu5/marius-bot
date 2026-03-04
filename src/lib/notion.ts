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
            page_size: 6
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
        .slice(0, 4)

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

export async function getNotionKnowledgeForAgent(telegramUserId: string, query: string) {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return null

    const connected = await isNotionConnected(telegramUserId)
    if (!connected) return null

    const accessToken = await getValidAccessTokenForUser(telegramUserId)
    const notion = new Client({ auth: accessToken })
    const contextItems = await findNotionContext(notion, normalizedQuery)

    if (contextItems.length === 0) {
        return "Keine passenden Notion-Inhalte gefunden."
    }

    const lines: string[] = []
    for (const [index, item] of contextItems.entries()) {
        lines.push(`Quelle ${index + 1}: ${item.title}`)
        if (item.url) lines.push(`URL: ${item.url}`)
        lines.push(`Inhalt: ${item.text}`)
        lines.push("")
    }

    return truncate(lines.join("\n").trim(), 2500)
}
