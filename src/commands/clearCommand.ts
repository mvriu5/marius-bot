import { type Message } from "chat"
import { Command, type CommandDefinition } from "../types/command.js"
import { clearMessageHistory, getMessageIds } from "../lib/messageHistory.js"

const clearCommand: CommandDefinition<"clear"> = {
    name: "clear",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        const cachedMessages: Message[] = []
        for await (const message of ctx.thread.allMessages) {
            cachedMessages.push(message)
        }

        const cachedById = new Map(cachedMessages.map((m) => [m.id, m]))
        const trackedIds = await getMessageIds(ctx.thread.id)
        const allIds = new Set([...cachedById.keys(), ...trackedIds])

        for (const messageId of allIds) {
            try {
                // For IDs not in cache, spread ctx.message and override the id so that
                // createSentMessageFromMessage has a valid Message shape. Only message.id
                // is used by the delete() implementation, so other fields don't matter.
                const msg = cachedById.get(messageId) ?? ({ ...ctx.message, id: messageId } as Message<unknown>)
                await ctx.thread.createSentMessageFromMessage(msg).delete()
            } catch {
                // ignore messages that cannot be deleted
            }
        }

        await clearMessageHistory(ctx.thread.id)
    }
}

export const clear = new Command(clearCommand)
