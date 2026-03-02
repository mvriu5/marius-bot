import { Actions, Button, Card, CardText, LinkButton } from "chat"
import {
    FitbitAuthorizationRequiredError,
    createFitbitAuthorizationUrl,
    getFitbitDailySummaryMessage
} from "../lib/fitbit.js"
import { Command, type CommandDefinition } from "../types/command.js"

type FitbitArgs = [] | [action: "login" | "summary"]

const fitbitCommand: CommandDefinition<"fitbit", FitbitArgs> = {
    name: "fitbit",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        const action = ctx.args[0]
        if (!action) {
            await ctx.thread.post(
                Card({
                    title: "Fitbit",
                    children: [
                        CardText("Wähle einen Subcommand:"),
                        Actions([
                            Button({
                                id: "command:fitbit:login",
                                label: "🔗 Login",
                                value: "fitbit login"
                            }),
                            Button({
                                id: "command:fitbit:summary",
                                label: "🗒️ Summary",
                                value: "fitbit summary"
                            })
                        ])
                    ]
                })
            )
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createFitbitAuthorizationUrl(ctx.message.author.userId)
                await ctx.thread.post(
                    Card({
                        title: "Fitbit Login",
                        children: [
                            CardText("Bitte verbinde Fitbit hier:"),
                            Actions([
                                LinkButton({ url: authorizationUrl, label: "Login" })
                            ])
                        ]
                    })
                )
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`⚠️ Fitbit Login konnte nicht gestartet werden: ${details}`)
            }
            return
        }

        if (action !== "summary") {
            await ctx.thread.post("⚠️ Unbekannter Fitbit-Subcommand.")
            return
        }

        try {
            const summary = await getFitbitDailySummaryMessage(ctx.message.author.userId)
            const formatMinutes = (totalMinutes: number) => {
                if (!totalMinutes || totalMinutes <= 0) return "0m"
                const hours = Math.floor(totalMinutes / 60)
                const minutes = totalMinutes % 60
                if (hours === 0) return `${minutes}m`
                return `${hours}h ${minutes}m`
            }

            await ctx.thread.post(
                Card({
                    title: "Fitbit Tagesübersicht",
                    children: [
                        CardText(`💤 Sleep Score: ${summary.sleepScore ?? "n/a"}`),
                        CardText(`🕑 Schlaf: ${formatMinutes(summary.totalMinutesAsleep)} (im Bett: ${formatMinutes(summary.totalTimeInBed)})`),
                        CardText(`💓 HRV (daily RMSSD): ${summary.hrvDailyRmssd ?? "n/a"} ms`),
                        CardText(`📉 Tiefste Herzfrequenz: ${summary.lowestHeartRate ?? "n/a"} bpm`)
                    ]
                })
            )
        } catch (error) {
            if (error instanceof FitbitAuthorizationRequiredError) {
                await ctx.thread.post(
                    Card({
                        title: "Fitbit Login",
                        children: [
                            CardText("Bitte verbinde zuerst Fitbit:"),
                            Actions([
                                LinkButton({ url: error.authorizationUrl, label: "Login" })
                            ])
                        ]
                    })
                )
                return
            }

            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`⚠️ Fitbit konnte nicht geladen werden: ${details}`)
        }
    }
}

export const fitbit = new Command(fitbitCommand)
