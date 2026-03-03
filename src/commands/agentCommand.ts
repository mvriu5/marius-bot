import { postAgentReply } from "../agent/reply.js"
import { postThreadError } from "../errors/errorOutput.js"
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
                await ctx.thread.post("Agent-Modus ist fuer 10 Minuten aktiv. Schreibe jetzt einfach deine Nachrichten ohne /agent.")
                return
            }

            await postAgentReply(ctx.thread, ctx.parsedArgs.question)
        } catch (error) {
            await postThreadError(ctx.thread, error, "Agent konnte nicht antworten")
        }
    }
}

export const agent = new Command(agentCommand)
