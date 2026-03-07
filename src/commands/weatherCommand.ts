import { Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { formatTemperatureC } from "../lib/dateTimeFormat.js"
import {
    getRememberedWeatherLocation,
    getWeather,
    rememberWeatherLocation
} from "../integrations/weather.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { defineCommandModule } from "./shared/module.js"

type WeatherParsedArgs =
    | { mode: "set"; location: string }
    | { mode: "query"; day: "today" | "tomorrow"; location?: string }

const weatherCommand: CommandDefinition<"weather", WeatherParsedArgs> = {
    name: "weather",
    argPolicy: { type: "any" },
    parseArgs: (rawArgs) => {
        const args = rawArgs.map((arg) => arg.trim()).filter(Boolean)
        const [firstArg, ...restArgs] = args
        const firstNormalized = firstArg?.toLowerCase()

        if (firstNormalized === "set") {
            const location = restArgs.join(" ").trim()
            if (!location) {
                return { ok: false, message: "Bitte nutze: /weather set <location>" }
            }
            return { ok: true, value: { mode: "set", location } }
        }

        if (firstNormalized === "tomorrow" || firstNormalized === "morgen") {
            const location = restArgs.join(" ").trim()
            return {
                ok: true,
                value: {
                    mode: "query",
                    day: "tomorrow",
                    location: location || undefined
                }
            }
        }

        const location = args.join(" ").trim()
        return {
            ok: true,
            value: {
                mode: "query",
                day: "today",
                location: location || undefined
            }
        }
    },
    execute: async (ctx) => {
        try {
            const userId = ctx.message.author.userId

            if (ctx.parsedArgs.mode === "set") {
                const summary = await getWeather(ctx.parsedArgs.location, 0)
                await rememberWeatherLocation(userId, ctx.parsedArgs.location)

                await ctx.thread.post(
                    Card({
                        title: "Wetter Standard-Location gesetzt",
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
                    await ctx.thread.post("Keine Standard-Location gesetzt. Nutze /weather set <location> oder /weather <location>.")
                    return
                }
            }

            const summary = ctx.parsedArgs.day === "tomorrow"
                ? await getWeather(locationForQuery, 1)
                : await getWeather(locationForQuery, 0)

            if (ctx.parsedArgs.day === "tomorrow") {
                await ctx.thread.post(
                    Card({
                        title: `Wetter Morgen (${summary.locationLabel})`,
                        children: [
                            CardText(`${summary.conditionEmoji} Prognose: ${summary.condition}`),
                            CardText(`🔥 Min/Max: ${formatTemperatureC(summary.minTempC)} / ${formatTemperatureC(summary.maxTempC)}`),
                            CardText(`💧 Regenwahrscheinlichkeit: ${summary.precipitationProbabilityPct ?? "n/a"} %`),
                        ]
                    })
                )
                return
            }

            await ctx.thread.post(
                Card({
                    title: `Wetter Heute (${summary.locationLabel})`,
                    children: [
                        CardText(`${summary.conditionEmoji} Zustand: ${summary.condition}`),
                        CardText(`✨ Jetzt: ${formatTemperatureC(summary.temperatureC)} (gefuehlt ${formatTemperatureC(summary.apparentTemperatureC)})`),
                        CardText(`💨 Wind: ${summary.windSpeedKmh ?? "n/a"} km/h`),
                        CardText(`🔥 Heute min/max: ${formatTemperatureC(summary.minTempC)} / ${formatTemperatureC(summary.maxTempC)}`),
                        CardText(`💧 Regenwahrscheinlichkeit: ${summary.precipitationProbabilityPct ?? "n/a"} %`)
                    ]
                })
            )
        } catch (error) {
            await postThreadError(ctx.thread, error, "Wetter konnte nicht geladen werden")
        }
    }
}

export const weather = createCommand(weatherCommand)

export const weatherModule = defineCommandModule({
    command: weather,
    description: "Zeigt das Wetter oder speichert eine Standard-Location.",
    aliases: ["wetter"] as const,
    subcommands: ["set <location>", "tomorrow [location]"] as const,
    actionIds: [] as const
})
