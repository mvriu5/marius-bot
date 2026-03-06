import { Actions, Button, Card, CardText, LinkButton, emoji, type EmojiValue, type Message, type Thread } from "chat"
import type { ModelMessage } from "ai"
import { streamAgent, resolveNotionTools } from "./agent.js"
import { extractTwoChoices } from "./choice.js"

type AgentThread = Thread<Record<string, unknown>, unknown>

const MAX_HISTORY_MESSAGES = 10

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
    return input.replace(/:([a-z0-9_]+):/gi, (full, rawName: string) => {
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

export async function postAgentReply(
    thread: AgentThread,
    question: string,
    sourceMessage?: Message<unknown>
): Promise<void> {
    thread.startTyping()

    const telegramUserId = sourceMessage?.author.userId
    const [, notionConfig] = await Promise.all([
        thread.refresh(),
        resolveNotionTools(telegramUserId)
    ])

    const history: ModelMessage[] = thread.recentMessages
        .filter((msg) => {
            const text = msg.text.trim()
            return text && !text.startsWith("/")
        })
        .slice(-MAX_HISTORY_MESSAGES)
        .map((msg) => ({
            role: msg.author.isMe ? "assistant" : "user",
            content: msg.text.trim()
        }))

    const { textStream, getAnswer } = await streamAgent(question, history, {
        telegramUserId,
        notionConfig
    })

    const sentMessage = await thread.post(textStream)

    const answer = await getAnswer()
    const answerText = answer.text
    const renderedText = renderEmojiTokens(answerText)
    const urls = extractUrls(renderedText)
    const choices = extractTwoChoices(renderedText)
    const safeRenderedText = escapeTelegramMarkdown(renderedText)

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
                    : [])
                ,
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
