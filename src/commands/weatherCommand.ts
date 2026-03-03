import { Card, CardText } from "chat"
import {
    getRememberedWeatherLocation,
    getTodayWeather,
    rememberWeatherLocation
} from "../lib/weather.js"
import { Command, type CommandDefinition } from "../types/command.js"

type WeatherParsedArgs =
    | { mode: "set"; location: string }
    | { mode: "query"; location?: string }

const weatherCommand: CommandDefinition<"weather", WeatherParsedArgs> = {
    name: "weather",
    argPolicy: { type: "any" },
    parseArgs: (rawArgs) => {
        const args = rawArgs.map((arg) => arg.trim()).filter(Boolean)
        const [firstArg, ...restArgs] = args

        if (firstArg?.toLowerCase() === "set") {
            const location = restArgs.join(" ").trim()
            if (!location) {
                return { ok: false, message: "Bitte nutze: /weather set <location>" }
            }
            return { ok: true, value: { mode: "set", location } }
        }

        const location = args.join(" ").trim()
        return { ok: true, value: { mode: "query", location: location || undefined } }
    },
    execute: async (ctx) => {
        try {
            const userId = ctx.message.author.userId

            if (ctx.parsedArgs.mode === "set") {
                const summary = await getTodayWeather(ctx.parsedArgs.location)
                await rememberWeatherLocation(userId, ctx.parsedArgs.location)

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

            let locationForQuery = ctx.parsedArgs.location ?? ""
            if (!locationForQuery) {
                locationForQuery = (await getRememberedWeatherLocation(userId)) ?? ""
                if (!locationForQuery) {
                    await ctx.thread.post("⚠️ Keine Standard-Location gesetzt. Nutze /weather set <location> oder /weather <location>.")
                    return
                }
            }

            const summary = await getTodayWeather(locationForQuery)
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
