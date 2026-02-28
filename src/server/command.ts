import { Message, Thread } from "chat"
import { FitbitAuthorizationRequiredError, getFitbitDailySummaryMessage } from "../lib/fitbit.js"
import { getNewsSummaryMessage } from "../lib/news.js"
import { getWeatherSummaryMessage } from "../lib/weather.js"

export const COMMAND_NAMES = ["fitbit", "weather", "news", "help"] as const

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
    },
    {
        name: "weather",
        execute: async (ctx) => {
            try {
                const summary = await getWeatherSummaryMessage()
                await ctx.thread.post(summary)
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`Wetter konnte nicht geladen werden: ${details}`)
            }
        }
    },
    {
        name: "news",
        execute: async (ctx) => {
            try {
                const summary = await getNewsSummaryMessage()
                await ctx.thread.post(summary)
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`News konnten nicht geladen werden: ${details}`)
            }
        }
    }
]

export const getCommand = (name: CommandName): Command | undefined =>
    commands.find((command) => command.name === name)
