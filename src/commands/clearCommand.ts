import { type Message } from "chat"
import { Command, type CommandDefinition } from "../types/command.js"
import { clearMessageHistory, getMessageIds } from "../lib/messageHistory.js"
import { clearAgentSession } from "../agent/session.js"

const clearCommand: CommandDefinition<"clear"> = {
    name: "clear",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        const knownById = new Map<string, Message>()

        for await (const message of ctx.thread.allMessages) {
            knownById.set(message.id, message)
        }

        for await (const message of ctx.thread.channel.messages) {
            knownById.set(message.id, message)
        }

        const trackedThreadIds = await getMessageIds(ctx.thread.id)
        const trackedChannelIds =
            ctx.thread.channel.id !== ctx.thread.id
                ? await getMessageIds(ctx.thread.channel.id)
                : []
        const allIds = new Set([
            ...knownById.keys(),
            ...trackedThreadIds,
            ...trackedChannelIds
        ])

        for (const messageId of allIds) {
            try {
                const msg = knownById.get(messageId) ?? ({ ...ctx.message, id: messageId } as Message<unknown>)
                await ctx.thread.createSentMessageFromMessage(msg).delete()
            } catch {
                // ignore messages that cannot be deleted
            }
        }

        await clearMessageHistory(ctx.thread.id)
        if (ctx.thread.channel.id !== ctx.thread.id) {
            await clearMessageHistory(ctx.thread.channel.id)
        }
        await clearAgentSession(ctx.thread.id, ctx.message.author.userId)
    }
}

export const clear = new Command(clearCommand)
