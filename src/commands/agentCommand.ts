import { postAgentReply } from "../agent/reply.js"
import { activateAgentSession } from "../agent/session.js"
import { Command, type CommandDefinition } from "../types/command.js"

type AgentParsedArgs = {
    question?: string
}

const agentCommand: CommandDefinition<"agent", AgentParsedArgs> = {
    name: "agent",
    argPolicy: { type: "any" },
    parseArgs: (args) => {
        const question = args.join(" ").trim()
        return { ok: true, value: { question: question || undefined } }
    },
    execute: async (ctx) => {
        try {
            await activateAgentSession(ctx.thread.id, ctx.message.author.userId)

            if (!ctx.parsedArgs.question) {
                await ctx.thread.post("Agent-Modus ist für 10 Minuten aktiv. Schreibe jetzt einfach deine Nachrichten ohne /agent.")
                return
            }

            await postAgentReply(ctx.thread, ctx.parsedArgs.question)
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`WARN: Agent konnte nicht antworten: ${details}`)
        }
    }
}

export const agent = new Command(agentCommand)
