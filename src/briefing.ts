import { Message, Thread } from "chat"
import { getCommand, type CommandContext, type CommandName, COMMAND_NAMES } from "./command.js"
import { ensureStateConnected, state } from "./state.js"

const BRIEFING_TARGETS_KEY = "briefing:targets"

type BriefingTargets = Record<string, string>

type BotWithAdapter = {
    getAdapter: (name: "telegram") => {
        postMessage: (threadId: string, message: string) => Promise<unknown>
    }
}

export async function rememberBriefingTarget(telegramUserId: string, threadId: string) {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}
    targets[telegramUserId] = threadId

    await state.set(BRIEFING_TARGETS_KEY, targets)
}

function getBriefingCommandNames() {
    return COMMAND_NAMES.filter((name): name is CommandName => name !== "help")
}

export async function runDailyBriefing(bot: BotWithAdapter) {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}
    const adapter = bot.getAdapter("telegram")

    const commands = getBriefingCommandNames()
    let recipients = 0
    let executed = 0

    for (const [telegramUserId, threadId] of Object.entries(targets)) {
        recipients += 1

        const thread = {
            id: threadId,
            post: async (text: string) => {
                await adapter.postMessage(threadId, text)
            }
        } as unknown as Thread<Record<string, unknown>, unknown>

        for (const commandName of commands) {
            const command = getCommand(commandName)
            if (!command) continue

            const message = {
                text: `/${commandName}`,
                author: { userId: telegramUserId }
            } as unknown as Message<unknown>

            const ctx: CommandContext = {
                thread,
                message,
                command: commandName,
                args: []
            }

            try {
                await command.execute(ctx)
                executed += 1
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error)
                await thread.post(`Daily briefing Fehler bei /${commandName}: ${details}`)
            }
        }
    }

    return { recipients, executed }
}
