import { Actions, Button, Card, CardText, type Thread } from "chat"
import type { ModelMessage } from "ai"
import { askAgent } from "./agent.js"
import { extractTwoChoices } from "./choice.js"

type AgentThread = Thread<Record<string, unknown>, unknown>

export async function postAgentReply(thread: AgentThread, question: string): Promise<void> {
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
    const choices = extractTwoChoices(answer)

    await thread.post(
        Card({
            children: [
                CardText(answer),
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
}
