import { openai } from "@ai-sdk/openai"
import { type ModelMessage, stepCountIs, tool, type ToolSet, ToolLoopAgent } from "ai"
import { emoji } from "chat"
import { z } from "zod/v4"
import { ProviderError } from "../errors/appError.js"
import {
    getNotionPageForAgent,
    NotionAuthorizationRequiredError,
    searchNotionForAgent
} from "../lib/notion.js"

type AgentAnswer = {
    text: string
    reactionName?: string
}

type AskAgentOptions = {
    telegramUserId?: string
    externalContext?: string
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
        "OpenAI-Antwort fehlgeschlagen. Bitte späeter erneut versuchen.",
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

function createAgentModel(model: string, availableEmojiNames: string, notionTools: ToolSet | undefined) {
    return new ToolLoopAgent({
        model: openai(model),
        stopWhen: stepCountIs(20),
        instructions: [
            "Du bist ein hilfreicher Assistent. Antworte klar und knapp auf Deutsch.",
            "Wenn die Frage Notion-Wissen erfordert, nutze zuerst search_notion und dann get_page mit passenden pageId-Werten.",
            "Wenn Notion nicht verbunden ist, sag klar, dass /notion login nötig ist.",
            "Nutze wenn sinnvoll Emojis aus dem Chat SDK als Token im Format :emoji_name:.",
            `Verfügbare Emoji-Namen: ${availableEmojiNames}.`,
            "Wenn eine Reaction zur letzten User-Nachricht hilfreich ist, füge genau ein Token [reaction:emoji_name] hinzu.",
            "Wenn keine Reaction sinnvoll ist, füge kein Reaction-Token hinzu."
        ].join(" "),
        tools: notionTools
    })
}

export async function askAgent(
    question: string,
    history: ModelMessage[] = [],
    options?: AskAgentOptions
): Promise<AgentAnswer> {
    const notionTools = options?.telegramUserId
        ? {
            search_notion: tool({
                description: "Sucht relevante Notion-Seiten zur Frage.",
                inputSchema: z.object({
                    query: z.string().min(2).max(200),
                    limit: z.number().int().min(1).max(8).default(5)
                }),
                execute: async ({ query, limit }) => {
                    try {
                        const results = await searchNotionForAgent(options.telegramUserId!, query, limit)
                        return { ok: true, results }
                    } catch (error) {
                        if (error instanceof NotionAuthorizationRequiredError) {
                            return {
                                ok: false,
                                error: "Notion ist nicht verbunden. Bitte /notion login ausfuehren.",
                                authorizationUrl: error.authorizationUrl
                            }
                        }
                        const details = error instanceof Error ? error.message : String(error)
                        return {
                            ok: false,
                            error: "Notion-Suche ist fehlgeschlagen.",
                            details
                        }
                    }
                }
            }),
            get_page: tool({
                description: "Lädt den Inhalt einer Notion-Seite per pageId.",
                inputSchema: z.object({
                    pageId: z.string().min(8),
                    maxChars: z.number().int().min(800).max(12000).default(6000)
                }),
                execute: async ({ pageId, maxChars }) => {
                    try {
                        const page = await getNotionPageForAgent(options.telegramUserId!, pageId, maxChars)
                        return { ok: true, page }
                    } catch (error) {
                        if (error instanceof NotionAuthorizationRequiredError) {
                            return {
                                ok: false,
                                error: "Notion ist nicht verbunden. Bitte /notion login ausführen.",
                                authorizationUrl: error.authorizationUrl
                            }
                        }

                        const details = error instanceof Error ? error.message : String(error)
                        return {
                            ok: false,
                            error: "Notion-Seite konnte nicht geladen werden.",
                            details
                        }
                    }
                }
            })
        }
        : undefined

    const models = ["gpt-5-nano", "gpt-4.1-mini"]

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

    let rawAnswer: string | undefined
    let lastError: unknown

    for (let index = 0; index < models.length; index += 1) {
        const model = models[index]
        const agent = createAgentModel(model, availableEmojiNames, notionTools)

        try {
            const result = await agent.generate({ messages })
            rawAnswer = result.text?.trim()
            break
        } catch (error) {
            lastError = error
            const hasNextModel = index < models.length - 1

            if (hasNextModel && isRateLimitError(error)) {
                continue
            }

            throw normalizeAgentError(error)
        }
    }

    if (!rawAnswer && lastError) {
        throw normalizeAgentError(lastError)
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
