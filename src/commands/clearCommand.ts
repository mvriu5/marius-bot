import { type Message } from "chat"
import { Command, type CommandDefinition } from "../types/command.js"
import { clearMessageHistory, getMessageIds } from "../lib/messageHistory.js"
import { clearAgentSession } from "../agent/session.js"

const CLEAR_LOOKBACK_LIMIT = Math.max(50, 1000)

function parseCompositeMessageId(value: string) {
    const match = value.match(/^(-?\d+):(\d+)$/)
    if (!match) return null

    const chatId = match[1]
    const messageId = Number(match[2])
    if (!Number.isInteger(messageId) || messageId <= 0) return null

    return { chatId, messageId }
}

const clearCommand: CommandDefinition<"clear", {}> = {
    name: "clear",
    argPolicy: { type: "none" },
    parseArgs: () => ({ ok: true, value: {} }),
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

        // Telegram doesn't provide full history listing. Sweep a lookback range so
        // bot/channel messages are still removed even if they weren't cached/tracked.
        const parsedCurrent = parseCompositeMessageId(ctx.message.id)
        if (parsedCurrent) {
            const minMessageId = Math.max(1, parsedCurrent.messageId - CLEAR_LOOKBACK_LIMIT + 1)
            for (let id = parsedCurrent.messageId; id >= minMessageId; id -= 1) {
                allIds.add(`${parsedCurrent.chatId}:${id}`)
            }
        }

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
