import { Card, CardText } from "chat"
import {
    getRememberedWeatherLocation,
    getWeatherSummaryMessage,
    rememberWeatherLocation
} from "../lib/weather.js"
import { Command, type CommandDefinition } from "../types/command.js"

type WeatherArgs = string[]

const weatherCommand: CommandDefinition<"weather", WeatherArgs> = {
    name: "weather",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        try {
            const args = ctx.args.map((arg) => arg.trim()).filter(Boolean)
            const [firstArg, ...restArgs] = args
            const userId = ctx.message.author.userId

            if (firstArg?.toLowerCase() === "set") {
                const locationToSet = restArgs.join(" ").trim()
                if (!locationToSet) {
                    await ctx.thread.post("Bitte nutze: /weather set <location>")
                    return
                }

                const summary = await getWeatherSummaryMessage(locationToSet)
                await rememberWeatherLocation(userId, locationToSet)

                await ctx.thread.post(
                    Card({
                        title: "✅ Wetter Standard-Location gesetzt",
                        children: [
                            CardText(`Location: ${summary.locationLabel}`),
                            CardText("Ab jetzt nutzt /weather diese gespeicherte Location.")
                        ]
                    })
                )
                return
            }

            let locationForQuery = args.join(" ").trim()
            if (!locationForQuery) {
                locationForQuery = (await getRememberedWeatherLocation(userId)) ?? ""
                if (!locationForQuery) {
                    await ctx.thread.post("⚠️ Keine Standard-Location gesetzt. Nutze /weather set <location> oder /weather <location>.")
                    return
                }
            }

            const summary = await getWeatherSummaryMessage(locationForQuery)
            const formatTemp = (value: number | undefined) => value === undefined || Number.isNaN(value) ? "n/a" : `${value.toFixed(1)}C`

            await ctx.thread.post(
                Card({
                    title: `Wetter (${summary.locationLabel})`,
                    children: [
                        CardText(`${summary.conditionEmoji} Zustand: ${summary.condition}`),
                        CardText(`🌡️ Jetzt: ${formatTemp(summary.temperatureC)} (gefühlt ${formatTemp(summary.apparentTemperatureC)})`),
                        CardText(`💨 Wind: ${summary.windSpeedKmh ?? "n/a"} km/h`),
                        CardText(`🔥 Heute min/max: ${formatTemp(summary.minTempC)} / ${formatTemp(summary.maxTempC)}`),
                        CardText(`💧 Regenwahrscheinlichkeit: ${summary.precipitationProbabilityPct ?? "n/a"} %`)
                    ]
                })
            )
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`⚠️ Wetter konnte nicht geladen werden: ${details}`)
        }
    }
}

export const weather = new Command(weatherCommand)
