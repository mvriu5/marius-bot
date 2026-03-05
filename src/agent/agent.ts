import { openai } from "@ai-sdk/openai"
import { type ModelMessage, stepCountIs, type ToolSet, ToolLoopAgent } from "ai"
import { emoji } from "chat"
import { ProviderError } from "../errors/appError.js"
import { getValidAccessTokenForUser, NotionAuthorizationRequiredError } from "../lib/notion.js"

type AgentAnswer = {
    text: string
    reactionName?: string
}

type AskAgentOptions = {
    telegramUserId?: string
    externalContext?: string
}

type NotionToolConfig = {
    tools?: ToolSet
    loginRequired: boolean
    mode: "none" | "mcp"
}

const DEFAULT_AGENT_MODEL = "gpt-5-nano"
const DEFAULT_NOTION_MCP_SERVER_URL = "https://mcp.notion.com/mcp"

function logMcp(event: string, data?: Record<string, unknown>) {
    if (data) {
        console.info(`[agent.mcp] ${event}`, data)
        return
    }
    console.info(`[agent.mcp] ${event}`)
}

function parseRetryAfterSeconds(details: string): number | undefined {
    const match = details.match(/try again in\s+(\d+)s/i)
    if (!match) return undefined

    const seconds = Number.parseInt(match[1], 10)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

function collectErrorDetails(error: unknown): string {
    if (error instanceof Error) {
        const message = error.message?.trim()
        return message || "Unbekannter Fehler"
    }

    return String(error)
}

function isRateLimitError(error: unknown): boolean {
    const details = collectErrorDetails(error).toLowerCase()
    return details.includes("rate limit") || details.includes("429")
}

function normalizeAgentError(error: unknown): ProviderError {
    const details = collectErrorDetails(error)

    if (isRateLimitError(error)) {
        const retryAfterSeconds = parseRetryAfterSeconds(details)
        const retryHint = retryAfterSeconds
            ? ` Bitte in etwa ${retryAfterSeconds} Sekunden erneut versuchen.`
            : " Bitte gleich erneut versuchen."

        return new ProviderError(
            "openai",
            "OPENAI_RATE_LIMIT",
            `OpenAI ist gerade ausgelastet.${retryHint}`,
            502,
            details,
            error
        )
    }

    return new ProviderError(
        "openai",
        "OPENAI_GENERATION_FAILED",
        "OpenAI-Antwort fehlgeschlagen. Bitte spaeter erneut versuchen.",
        502,
        details,
        error
    )
}

function parseAgentOutput(raw: string): AgentAnswer {
    const reactionMatch = raw.match(/\[reaction:([a-z0-9_]+)\]/i)
    const reactionName = reactionMatch?.[1]?.toLowerCase()
    const text = raw.replace(/\[reaction:[^\]]+\]/gi, "").trim()

    return {
        text,
        reactionName
    }
}

async function resolveNotionTools(telegramUserId?: string): Promise<NotionToolConfig> {
    if (!telegramUserId) {
        logMcp("skipped:no-user")
        return { loginRequired: false, mode: "none" }
    }

    try {
        logMcp("token:load:start", { telegramUserId })
        const accessToken = await getValidAccessTokenForUser(telegramUserId)
        const serverUrl = process.env.NOTION_MCP_SERVER_URL?.trim() || DEFAULT_NOTION_MCP_SERVER_URL
        logMcp("token:load:ok", { telegramUserId, serverUrl })

        const config: NotionToolConfig = {
            loginRequired: false,
            mode: "mcp",
            tools: {
                notion_mcp: openai.tools.mcp({
                    serverLabel: "notion",
                    serverUrl,
                    authorization: accessToken,
                    requireApproval: "never"
                })
            }
        }
        logMcp("tool:configured", { telegramUserId, mode: config.mode, serverUrl })
        return config
    } catch (error) {
        if (error instanceof NotionAuthorizationRequiredError) {
            logMcp("token:missing", { telegramUserId })
            return { loginRequired: true, mode: "none" }
        }

        logMcp("token:load:error", {
            telegramUserId,
            error: collectErrorDetails(error)
        })
        throw error
    }
}

function createAgentModel(options: {
    model: string
    availableEmojiNames: string
    notionTools: ToolSet | undefined
    notionLoginRequired: boolean
}) {
    const instructions = [
        "Du bist ein hilfreicher Assistent. Antworte klar und knapp auf Deutsch.",
        "Nutze wenn sinnvoll Emojis aus dem Chat SDK als Token im Format :emoji_name:.",
        `Verfuegbare Emoji-Namen: ${options.availableEmojiNames}.`,
        "Wenn eine Reaction zur letzten User-Nachricht hilfreich ist, fuege genau ein Token [reaction:emoji_name] hinzu.",
        "Wenn keine Reaction sinnvoll ist, fuege kein Reaction-Token hinzu."
    ]

    if (options.notionTools) {
        instructions.push("Wenn die Frage Notion-Wissen erfordert, nutze die verfuegbaren Notion-Tools statt Inhalte zu raten.")
    }

    if (options.notionLoginRequired) {
        instructions.push("Notion ist nicht verbunden. Sage klar, dass /notion login noetig ist.")
    }

    return new ToolLoopAgent({
        model: openai(options.model),
        stopWhen: stepCountIs(20),
        instructions: instructions.join(" "),
        tools: options.notionTools
    })
}

export async function askAgent(
    question: string,
    history: ModelMessage[] = [],
    options?: AskAgentOptions
): Promise<AgentAnswer> {
    const notion = await resolveNotionTools(options?.telegramUserId)

    const model = process.env.OPENAI_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL
    logMcp("agent:start", {
        telegramUserId: options?.telegramUserId,
        model,
        notionMode: notion.mode,
        notionLoginRequired: notion.loginRequired
    })

    const availableEmojiNames = Object.keys(emoji).join(", ")
    const messages: ModelMessage[] = [...history, { role: "user", content: question }]

    if (options?.externalContext?.trim()) {
        messages.unshift({
            role: "system",
            content: [
                "Zusatzkontext aus Notion (nutze ihn nur, wenn er zur Frage passt):",
                options.externalContext.trim(),
                "Wenn die Information darin nicht ausreicht, sage das offen."
            ].join("\n\n")
        })
    }

    const agent = createAgentModel({
        model,
        availableEmojiNames,
        notionTools: notion.tools,
        notionLoginRequired: notion.loginRequired
    })

    let rawAnswer: string | undefined
    try {
        logMcp("agent:generate:start", { model, notionMode: notion.mode })
        const result = await agent.generate({ messages })
        rawAnswer = result.text?.trim()
        logMcp("agent:generate:ok", {
            model,
            notionMode: notion.mode,
            hasText: Boolean(rawAnswer),
            textLength: rawAnswer?.length ?? 0
        })
    } catch (error) {
        logMcp("agent:generate:error", {
            model,
            notionMode: notion.mode,
            error: collectErrorDetails(error)
        })
        throw normalizeAgentError(error)
    }

    if (!rawAnswer) {
        throw new ProviderError(
            "openai",
            "OPENAI_EMPTY_RESPONSE",
            "Agent konnte keine Antwort erzeugen.",
            502,
            "OpenAI lieferte keine Antwort."
        )
    }

    const parsed = parseAgentOutput(rawAnswer)
    if (!parsed.text) {
        return {
            text: "",
            reactionName: parsed.reactionName
        }
    }

    return parsed
}
