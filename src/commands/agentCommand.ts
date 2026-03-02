import { Command, type CommandDefinition } from "../types/command.js"
import { postAgentReply } from "../agent/reply.js"
import { activateAgentSession } from "../agent/session.js"

const agentCommand: CommandDefinition<"agent"> = {
    name: "agent",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        const question = ctx.args.join(" ").trim()

        try {
            await activateAgentSession(ctx.thread.id, ctx.message.author.userId)

            if (!question) {
                await ctx.thread.post("Agent-Modus ist für 10 Minuten aktiv. Schreibe jetzt einfach deine Nachrichten ohne /agent.")
                return
            }

            await postAgentReply(ctx.thread, question)
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`WARN: Agent konnte nicht antworten: ${details}`)
        }
    }
}

export const agent = new Command(agentCommand)
