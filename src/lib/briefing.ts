import { Message, Thread } from "chat"
import { getCommand, isValidCommand } from "../server/registry.js"
import { bot } from "../server/bot.js"
import { ensureStateConnected, state } from "../types/state.js"
import { CommandContext } from "../types/command.js"

const BRIEFING_TARGETS_KEY = "briefing:targets"

type BriefingTargets = Record<string, string>

export async function rememberBriefingTarget(telegramUserId: string, threadId: string) {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}
    targets[telegramUserId] = threadId

    await state.set(BRIEFING_TARGETS_KEY, targets)
}

async function runBriefingCommand(
    thread: Thread<Record<string, unknown>, unknown>,
    message: Message<unknown>,
    command: string,
    args: string[]
) {
    if (!isValidCommand(command)) {
        await thread.post(`Daily briefing Fehler: unbekannter Befehl ${command}`)
        return false
    }

    const ctx: CommandContext = {
        thread,
        message,
        command,
        args
    }

    await getCommand(command)?.execute(ctx)
    return true
}

export async function runDailyBriefing() {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}

    let recipients = 0
    let executed = 0

    for (const [telegramUserId, threadId] of Object.entries(targets)) {
        recipients += 1

        const adapter = bot.getAdapter("telegram")

        const thread = {
            id: threadId,
            post: async (msg: unknown) => {
                await adapter.postMessage(threadId, msg as never)
            },
            allMessages: {
                [Symbol.asyncIterator]() {
                    async function* gen() {
                        let cursor: string | undefined
                        while (true) {
                            const result = await adapter.fetchMessages(threadId, { direction: "forward", cursor })
                            for (const msg of result.messages) {
                                yield msg
                            }
                            if (!result.nextCursor) break
                            cursor = result.nextCursor
                        }
                    }
                    return gen()
                }
            },
            createSentMessageFromMessage: (msg: Message<unknown>) => ({
                ...msg,
                delete: async () => {
                    await adapter.deleteMessage(threadId, msg.id)
                },
                addReaction: async () => {},
                edit: async () => ({ ...msg }),
                removeReaction: async () => {}
            })
        } as unknown as Thread<Record<string, unknown>, unknown>

        const message = {
            text: "---DAILY-BRIEFING---",
            author: { userId: telegramUserId }
        } as unknown as Message<unknown>

        try {
            const ok = await runBriefingCommand(thread, message, "clear", [])
            if (ok) executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /clear: ${details}`)
        }

        try {
            const ok = await runBriefingCommand(thread, message, "fitbit", ["summary"])
            if (ok) executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /fitbit summary: ${details}`)
        }

        try {
            const ok = await runBriefingCommand(thread, message, "news", [])
            if (ok) executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /news: ${details}`)
        }

        try {
            const ok = await runBriefingCommand(thread, message, "meetings", ["summary"])
            if (ok) executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /meetings summary: ${details}`)
        }

        try {
            const ok = await runBriefingCommand(thread, message, "weather", [])
            if (ok) executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /weather: ${details}`)
        }
    }

    return { recipients, executed }
}
