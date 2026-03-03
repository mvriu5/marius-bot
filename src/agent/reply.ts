import { Actions, Button, Card, CardText, emoji, type Message, type Thread } from "chat"
import type { ModelMessage } from "ai"
import { logError } from "../errors/errorOutput.js"
import { askAgent } from "./agent.js"
import { extractTwoChoices } from "./choice.js"

type AgentThread = Thread<Record<string, unknown>, unknown>
type EmojiMap = Record<string, string>

function resolveEmojiByName(name: string): string | null {
    const map = emoji as unknown as EmojiMap
    return map[name] ?? null
}

function renderEmojiTokens(input: string): string {
    return input.replace(/:([a-z0-9_]+):/gi, (full, rawName: string) => {
        const value = resolveEmojiByName(rawName.toLowerCase())
        return value ?? full
    })
}

export async function postAgentReply(
    thread: AgentThread,
    question: string,
    sourceMessage?: Message<unknown>
): Promise<void> {
    thread.startTyping()

    await thread.refresh()
    const history: ModelMessage[] = thread.recentMessages
        .filter((msg) => {
            const text = msg.text.trim()
            return text && !text.startsWith("/")
        })
        .map((msg) => ({
            role: msg.author.isMe ? "assistant" : "user",
            content: msg.text.trim()
        }))

    const answer = await askAgent(question, history)
    const renderedText = renderEmojiTokens(answer.text)
    const choices = extractTwoChoices(renderedText)

    await thread.post(
        Card({
            children: [
                CardText(renderedText),
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
                logError("agent.reaction", error)
            }
        }
    }
}
