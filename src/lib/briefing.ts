import { Message, Thread } from "chat"
import { getCommand, isValidCommand } from "../server/registry.js"
import { bot } from "../server/bot.js"
import { ensureStateConnected, state } from "../types/state.js"
import { RawCommandContext } from "../types/command.js"
import { postThreadError } from "../errors/errorOutput.js"

const BRIEFING_TARGETS_KEY = "briefing:targets"

type BriefingTargets = Record<string, string>
type BriefingStep = {
    command: string
    args: string[]
    label: string
}

const BRIEFING_STEPS: BriefingStep[] = [
    { command: "clear", args: [], label: "/clear" },
    { command: "fitbit", args: ["summary"], label: "/fitbit summary" },
    { command: "news", args: [], label: "/news" },
    { command: "analytics", args: [], label: "/analytics" },
    { command: "meetings", args: ["summary"], label: "/meetings summary" },
    { command: "weather", args: [], label: "/weather" }
]

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

    const commandDef = getCommand(command)
    if (!commandDef) {
        await thread.post(`Daily briefing Fehler: unbekannter Befehl ${command}`)
        return false
    }
    if (!commandDef.validateArgs(args)) {
        await thread.post(`Daily briefing Fehler: ungueltige Argumente fuer /${command}`)
        return false
    }

    const ctx: RawCommandContext = {
        thread,
        message,
        command,
        args
    }

    const parsed = commandDef.parseArgs(args)
    if (!parsed.ok) {
        await thread.post(`Daily briefing Fehler: ${parsed.message}`)
        return false
    }

    await commandDef.execute(ctx, parsed.value)
    return true
}

async function runBriefingStep(
    thread: Thread<Record<string, unknown>, unknown>,
    message: Message<unknown>,
    step: BriefingStep
) {
    try {
        return await runBriefingCommand(thread, message, step.command, step.args)
    } catch (error) {
        await postThreadError(thread, error, `Daily briefing Fehler bei ${step.label}`)
        return false
    }
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

        for (const step of BRIEFING_STEPS) {
            const ok = await runBriefingStep(thread, message, step)
            if (ok) {
                executed += 1
            }
        }
    }

    return { recipients, executed }
}
