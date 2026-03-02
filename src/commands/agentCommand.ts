import { Actions, Button, Card, CardText } from "chat"
import type { ModelMessage } from "ai"
import { Command, type CommandDefinition } from "../types/command.js"
import { askAgent, extractTwoChoices } from "../lib/agent.js"

const agentCommand: CommandDefinition<"agent"> = {
    name: "agent",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        const question = ctx.args.join(" ").trim()
        if (!question) {
            await ctx.thread.post("Bitte nutze: /agent <deine Frage>")
            return
        }

        try {
            ctx.thread.startTyping()

            await ctx.thread.refresh()
            const history: ModelMessage[] = ctx.thread.recentMessages
                .filter((msg) => {
                    const text = msg.text.trim()
                    return text && !text.startsWith("/agent")
                })
                .map((msg) => ({
                    role: msg.author.isMe ? "assistant" : "user",
                    content: msg.text.trim()
                }))

            const answer = await askAgent(question, history)
            const choices = extractTwoChoices(answer)

            await ctx.thread.post(
                Card({
                    children: [
                        CardText(answer),
                        ...(choices ? [
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
                            ])]
                        : [])
                    ]
                })
            )
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`⚠️ Agent konnte nicht antworten: ${details}`)
        }
    }
}

export const agent = new Command(agentCommand)
