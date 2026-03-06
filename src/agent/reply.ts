import { Actions, Button, Card, CardText, LinkButton, emoji, type EmojiValue, type Message, type Thread } from "chat"
import type { ModelMessage } from "ai"
import { streamAgent, resolveNotionTools } from "./agent.js"
import { extractTwoChoices } from "./choice.js"

type AgentThread = Thread<Record<string, unknown>, unknown>

const MAX_HISTORY_MESSAGES = 6
const MAX_HISTORY_MESSAGE_CHARS = 500
const MAX_HISTORY_TOTAL_CHARS = 2500

function truncateText(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value
    return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function escapeTelegramMarkdown(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/([_*\[\]()`])/g, "\\$1")
}

function resolveEmojiByName(name: string): EmojiValue | null {
    const normalized = name.toLowerCase().trim()
    const candidate = (emoji as unknown as Record<string, unknown>)[normalized]
    if (!candidate || typeof candidate !== "object") return null
    if (!("name" in candidate)) return null
    return candidate as EmojiValue
}

function renderEmojiTokens(input: string): string {
    const normalized = input
        .replace(/__emojiname:([a-z0-9_]+):__/gi, ":$1:")
        .replace(/\bemojiname:([a-z0-9_]+):/gi, ":$1:")

    return normalized.replace(/:([a-z0-9_]+):/gi, (full, rawName: string) => {
        const value = resolveEmojiByName(rawName.toLowerCase())
        return value ? value.toString() : full
    })
}

function extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? []
    const urls: string[] = []
    const seen = new Set<string>()

    for (const raw of matches) {
        const cleaned = raw.replace(/[),.!?;:]+$/, "")
        try {
            const parsed = new URL(cleaned)
            const normalized = parsed.toString()
            if (seen.has(normalized)) continue
            seen.add(normalized)
            urls.push(normalized)
        } catch {
            continue
        }
    }

    return urls
}

function isTelegramMessageNotModifiedError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.message.toLowerCase().includes("message is not modified")
}

export async function postAgentReply(
    thread: AgentThread,
    question: string,
    sourceMessage?: Message<unknown>
): Promise<void> {
    const startedAt = Date.now()
    thread.startTyping()

    const telegramUserId = sourceMessage?.author.userId
    const notionConfigPromise = resolveNotionTools(telegramUserId)

    let remainingHistoryChars = MAX_HISTORY_TOTAL_CHARS
    const history: ModelMessage[] = thread.recentMessages
        .filter((msg) => {
            const text = msg.text.trim()
            return text && !text.startsWith("/")
        })
        .slice(-MAX_HISTORY_MESSAGES)
        .map((msg) => {
            const trimmed = msg.text.trim()
            const perMessage = truncateText(trimmed, MAX_HISTORY_MESSAGE_CHARS)
            const withBudget = truncateText(perMessage, remainingHistoryChars)
            remainingHistoryChars = Math.max(0, remainingHistoryChars - withBudget.length)

            return {
                role: msg.author.isMe ? "assistant" : "user",
                content: withBudget
            }
        })
        .filter((msg) => Boolean(msg.content))

    const notionConfig = await notionConfigPromise
    const { textStream, getAnswer } = await streamAgent(question, history, {
        telegramUserId,
        notionConfig
    })

    console.info("[agent.latency] pre-stream-ms", {
        durationMs: Date.now() - startedAt,
        historyMessages: history.length,
        notionMode: notionConfig.mode
    })

    const sentMessage = await thread.post(textStream)

    const answer = await getAnswer()
    const answerText = answer.text
    const renderedText = renderEmojiTokens(answerText)
    const urls = extractUrls(renderedText)
    const choices = extractTwoChoices(renderedText)
    const safeRenderedText = escapeTelegramMarkdown(renderedText)
    const hasChoices = Boolean(choices)
    const hasUrls = urls.length > 0
    const textChanged = renderedText !== answerText

    if (textChanged || hasChoices || hasUrls) {
        try {
            await sentMessage.edit(
                Card({
                    children: [
                        CardText(safeRenderedText),
                        ...(choices
                            ? [
                                Actions([
                                    Button({
                                        id: "agent:choice",
                                        label: choices[0].label,
                                        value: choices[0].value
                                    }),
                                    Button({
                                        id: "agent:choice",
                                        label: choices[1].label,
                                        value: choices[1].value
                                    })
                                ])
                            ]
                            : []),
                        ...(urls.length > 0
                            ? [
                                Actions(
                                    urls.map((url, index) => {
                                        let label = `Link ${index + 1}`
                                        try {
                                            const host = new URL(url).hostname.replace(/^www\./i, "")
                                            if (host) label = host
                                        } catch {
                                        }
                                        return LinkButton({ label, url })
                                    })
                                )
                            ]
                            : [])
                    ]
                })
            )
        } catch (error) {
            if (!isTelegramMessageNotModifiedError(error)) throw error
            console.info("[agent.reply] skipped redundant message edit")
        }
    }

    if (sourceMessage?.id && answer.reactionName) {
        const reaction = resolveEmojiByName(answer.reactionName)
        if (reaction) {
            try {
                const userMessage = thread.createSentMessageFromMessage(sourceMessage)
                await userMessage.addReaction(reaction)
            } catch (error) {
                // Reactions are best-effort (platforms can reject unsupported emoji).
                const details = error instanceof Error ? error.message : String(error)
                console.info("[agent.reaction] skipped", {
                    reactionName: answer.reactionName,
                    reason: details
                })
            }
        }
    }
}
