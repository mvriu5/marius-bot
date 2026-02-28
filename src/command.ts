import { Message, Thread } from "chat"
import { FitbitAuthorizationRequiredError, getFitbitDailySummaryMessage } from "./lib/fitbit.js"
import { rememberBriefingTarget } from "./briefing.js"

export const COMMAND_NAMES = ["fitbit", "help"] as const

export type CommandName = typeof COMMAND_NAMES[number]

export type CommandContext = {
    thread: Thread<Record<string, unknown>, unknown>
    message: Message<unknown>
    command: CommandName
    args: string[]
}

export type Command = {
    name: CommandName
    execute: (ctx: CommandContext) => Promise<void>
}

export const commands: Command[] = [
    {
        name: "help",
        execute: async (ctx) => {
            await ctx.thread.post(
                `Verfügbare Befehle:\n` +
                COMMAND_NAMES.map((cmd) => `/${cmd}`).join("\n")
            )
            await rememberBriefingTarget(ctx.message.author.userId, ctx.thread.id)
        }
    },
    {
        name: "fitbit",
        execute: async (ctx) => {
            try {
                const summary = await getFitbitDailySummaryMessage(ctx.message.author.userId)
                await ctx.thread.post(summary)
            } catch (error) {
                if (error instanceof FitbitAuthorizationRequiredError) {
                    await ctx.thread.post(`Bitte verbinde zuerst Fitbit: ${error.authorizationUrl}`)
                    return
                }

                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`Fitbit konnte nicht geladen werden: ${details}`)
            }
        }
    }
]

export const getCommand = (name: CommandName): Command | undefined =>
    commands.find((command) => command.name === name)
