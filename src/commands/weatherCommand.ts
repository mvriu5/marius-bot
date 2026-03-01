import {
    getRememberedWeatherLocation,
    getWeatherSummaryMessage,
    rememberWeatherLocation
} from "../lib/weather.js"
import { Command, type CommandInit } from "../types/command-base.js"

type WeatherArgs = string[]

const weatherCommand: CommandInit<"weather", WeatherArgs> = {
    name: "weather",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        try {
            const input = ctx.args.join(" ").trim()
            if (input) await rememberWeatherLocation(ctx.message.author.userId, input)

            const location = input || await getRememberedWeatherLocation(ctx.message.author.userId)
            const summary = await getWeatherSummaryMessage(location)
            await ctx.thread.post(summary)
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`Wetter konnte nicht geladen werden: ${details}`)
        }
    }
}

export const weather = new Command(weatherCommand)
