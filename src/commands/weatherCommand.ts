import { Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import {
    getRememberedWeatherLocation,
    getWeather,
    rememberWeatherLocation
} from "../lib/weather.js"
import { Command, type CommandDefinition } from "../types/command.js"

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
            const formatTemp = (value: number | undefined) => value === undefined || Number.isNaN(value) ? "n/a" : `${value.toFixed(1)}C`
            const forecastLabel = ctx.parsedArgs.day === "tomorrow" ? "Morgen" : "Heute"

            await ctx.thread.post(
                Card({
                    title: `Wetter ${forecastLabel} (${summary.locationLabel})`,
                    children: [
                        CardText(`${summary.conditionEmoji} Zustand: ${summary.condition}`),
                        CardText(`Jetzt: ${formatTemp(summary.temperatureC)} (gefuehlt ${formatTemp(summary.apparentTemperatureC)})`),
                        CardText(`Wind: ${summary.windSpeedKmh ?? "n/a"} km/h`),
                        CardText(`${forecastLabel} min/max: ${formatTemp(summary.minTempC)} / ${formatTemp(summary.maxTempC)}`),
                        CardText(`Regenwahrscheinlichkeit: ${summary.precipitationProbabilityPct ?? "n/a"} %`)
                    ]
                })
            )
        } catch (error) {
            await postThreadError(ctx.thread, error, "Wetter konnte nicht geladen werden")
        }
    }
}

export const weather = new Command(weatherCommand)
