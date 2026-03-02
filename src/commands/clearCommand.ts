import { Command, type CommandDefinition } from "../types/command.js"

const clearCommand: CommandDefinition<"clear"> = {
    name: "clear",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        for await (const message of ctx.thread.allMessages) {
            try {
                await ctx.thread.createSentMessageFromMessage(message).delete()
            } catch {
                // ignore messages that cannot be deleted
            }
        }
    }
}

export const clear = new Command(clearCommand)
