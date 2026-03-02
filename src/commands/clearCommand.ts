import { type Message } from "chat"
import { Command, type CommandDefinition } from "../types/command.js"

const clearCommand: CommandDefinition<"clear"> = {
    name: "clear",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        const messages: Message[] = []
        for await (const message of ctx.thread.allMessages) {
            messages.push(message)
        }
        for (const message of messages) {
            try {
                await ctx.thread.createSentMessageFromMessage(message).delete()
            } catch {
                // ignore messages that cannot be deleted
            }
        }
    }
}

export const clear = new Command(clearCommand)
