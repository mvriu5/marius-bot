import { postAgentReply } from "../agent/reply.js"
import { postThreadError } from "../errors/errorOutput.js"
import { activateAgentSession } from "../agent/session.js"
import { parseOptionalJoinedArg } from "../lib/commandParsers.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { defineCommandModule } from "./shared/module.js"

type AgentParsedArgs = {
    question?: string
}

const agentCommand: CommandDefinition<"agent", AgentParsedArgs> = {
    name: "agent",
    argPolicy: { type: "any" },
    parseArgs: (args) => parseOptionalJoinedArg(args, "question"),
    execute: async (ctx) => {
        try {
            await activateAgentSession(ctx.thread.id, ctx.message.author.userId)

            if (!ctx.parsedArgs.question) {
                await ctx.thread.post("Agent-Modus ist für 10 Minuten aktiv. Schreibe jetzt einfach deine Nachrichten ohne /agent.")
                return
            }

            await postAgentReply(ctx.thread, ctx.parsedArgs.question, ctx.message)
        } catch (error) {
            await postThreadError(ctx.thread, error, "Agent konnte nicht antworten")
        }
    }
}

export const agent = createCommand(agentCommand)

export const agentModule = defineCommandModule({
    command: agent,
    description: "Aktiviert den Agent-Modus oder beantwortet eine Frage.",
    aliases: ["ai", "gpt", "ask"] as const,
    subcommands: ["<frage>"] as const,
    actionIds: [] as const
})
