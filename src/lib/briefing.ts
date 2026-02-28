import { Message, Thread } from "chat"
import { getCommand, type CommandContext, type CommandName, COMMAND_NAMES } from "../server/command.js"
import { ensureStateConnected, state } from "../server/state.js"
import { bot } from "../server/bot.js"

const BRIEFING_TARGETS_KEY = "briefing:targets"

type BriefingTargets = Record<string, string>


export async function rememberBriefingTarget(telegramUserId: string, threadId: string) {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}
    targets[telegramUserId] = threadId

    await state.set(BRIEFING_TARGETS_KEY, targets)
}

export async function runDailyBriefing() {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}
    const commands = COMMAND_NAMES.filter((name): name is CommandName => name !== "help")

    let recipients = 0
    let executed = 0

    for (const [telegramUserId, threadId] of Object.entries(targets)) {
        recipients += 1

        const thread = {
            id: threadId,
            post: async (text: string) => {
                await bot.getAdapter("telegram").postMessage(threadId, text)
            }
        } as unknown as Thread<Record<string, unknown>, unknown>

        for (const commandName of commands) {
            const command = getCommand(commandName)
            if (!command) continue

            const message = {
                text: `---${commandName}---`,
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
