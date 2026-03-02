import { Card, CardText } from "chat"
import { Command, type CommandDefinition } from "../types/command.js"
import { askAgent } from "../lib/agent.js"

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
            const answer = await askAgent(question)
            await ctx.thread.post(
                Card({
                    children: [CardText(answer)]
                })
            )
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`⚠️ Agent konnte nicht antworten: ${details}`)
        }
    }
}

export const agent = new Command(agentCommand)
