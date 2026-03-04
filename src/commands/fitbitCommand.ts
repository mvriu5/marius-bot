import { Actions, Button, Card, CardText, LinkButton, type Thread } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import {
    FitbitAuthorizationRequiredError,
    createFitbitAuthorizationUrl,
    getFitbitActivityData,
    getFitbitData,
    getFitbitWeekActivityData,
    isFitbitConnected
} from "../lib/fitbit.js"
import { Command, type CommandDefinition } from "../types/command.js"

type FitbitAction = "menu" | "login" | "summary" | "activity" | "week"
type FitbitParsedArgs = {
    action: FitbitAction
}

async function postFitbitLoginCard(
    thread: Thread<Record<string, unknown>, unknown>,
    authorizationUrl: string,
    text = "Bitte verbinde zuerst Fitbit:"
) {
    await thread.post(
        Card({
            title: "Fitbit Login",
            children: [
                CardText(text),
                Actions([
                    LinkButton({ url: authorizationUrl, label: "Login" })
                ])
            ]
        })
    )
}

async function handleFitbitAuthorizationError(
    thread: Thread<Record<string, unknown>, unknown>,
    error: unknown
) {
    if (!(error instanceof FitbitAuthorizationRequiredError)) return false
    await postFitbitLoginCard(thread, error.authorizationUrl)
    return true
}

const fitbitCommand: CommandDefinition<"fitbit", FitbitParsedArgs> = {
    name: "fitbit",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => {
        const action = args[0]
        if (!action) return { ok: true, value: { action: "menu" as const } }
        if (action === "login" || action === "summary" || action === "activity" || action === "week") {
            return { ok: true, value: { action } }
        }
        return { ok: false, message: "Unbekannter Fitbit-Subcommand" }
    },
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs
        if (action === "menu") {
            const userId = ctx.message.author.userId
            const connected = await isFitbitConnected(userId)

            if (!connected) {
                try {
                    const authorizationUrl = await createFitbitAuthorizationUrl(userId)
                    await postFitbitLoginCard(ctx.thread, authorizationUrl)
                } catch (error) {
                    await postThreadError(ctx.thread, error, "Fitbit Login konnte nicht gestartet werden")
                }
                return
            }

            await ctx.thread.post(
                Card({
                    title: "Fitbit",
                    children: [
                        CardText("Wähle einen Subcommand:"),
                        Actions([
                            Button({
                                id: "command:fitbit:summary",
                                label: "Summary",
                                value: "fitbit summary"
                            }),
                            Button({
                                id: "command:fitbit:activity",
                                label: "Activity",
                                value: "fitbit activity"
                            }),
                            Button({
                                id: "command:fitbit:week",
                                label: "Week",
                                value: "fitbit week"
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
                await postFitbitLoginCard(ctx.thread, authorizationUrl, "Bitte verbinde Fitbit hier:")
            } catch (error) {
                await postThreadError(ctx.thread, error, "Fitbit Login konnte nicht gestartet werden")
            }
            return
        }

        if (action === "activity") {
            try {
                const activity = await getFitbitActivityData(ctx.message.author.userId)
                const formatMinutes = (totalMinutes: number) => {
                    if (!totalMinutes || totalMinutes <= 0) return "0m"
                    const hours = Math.floor(totalMinutes / 60)
                    const minutes = totalMinutes % 60
                    if (hours === 0) return `${minutes}m`
                    return `${hours}h ${minutes}m`
                }

                await ctx.thread.post(
                    Card({
                        title: "Fitbit Aktivität Heute",
                        children: [
                            CardText(`Schritte: ${activity.steps}`),
                            CardText(`Distanz: ${activity.distanceKm.toFixed(2)} km`),
                            CardText(`Kalorien: ${activity.caloriesOut}`),
                            CardText(`Stockwerke: ${activity.floors}`),
                            CardText(
                                `Aktive Minuten: ${formatMinutes(activity.activeMinutes)} `
                                + `(leicht ${activity.lightlyActiveMinutes}m, fair ${activity.fairlyActiveMinutes}m, intensiv ${activity.veryActiveMinutes}m)`
                            )
                        ]
                    })
                )
            } catch (error) {
                if (await handleFitbitAuthorizationError(ctx.thread, error)) return
                await postThreadError(ctx.thread, error, "Fitbit Aktivität konnte nicht geladen werden")
            }
            return
        }

        if (action === "week") {
            try {
                const week = await getFitbitWeekActivityData(ctx.message.author.userId)
                const formatNumber = (value: number, digits = 0) => value.toFixed(digits)

                await ctx.thread.post(
                    Card({
                        title: "Fitbit Wochenübersicht",
                        children: [
                            CardText(`Tage mit Daten: ${week.days}`),
                            CardText(`� Schritte: ${formatNumber(week.avgSteps)}`),
                            CardText(`� Distanz: ${formatNumber(week.avgDistanceKm, 2)} km`),
                            CardText(`� Kalorien: ${formatNumber(week.avgCaloriesOut)}`),
                            CardText(`� Aktive Minuten: ${formatNumber(week.avgActiveMinutes)}`),
                            CardText(
                                week.bestStepsDate
                                    ? `Bester Tag: ${week.bestStepsDate} (${week.bestSteps} Schritte)`
                                    : "Bester Tag: n/a"
                            )
                        ]
                    })
                )
            } catch (error) {
                if (await handleFitbitAuthorizationError(ctx.thread, error)) return
                await postThreadError(ctx.thread, error, "Fitbit Wochenübersicht konnte nicht geladen werden")
            }
            return
        }

        try {
            const summary = await getFitbitData(ctx.message.author.userId)
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
                        CardText(`Schlaf: ${formatMinutes(summary.totalMinutesAsleep)} (im Bett: ${formatMinutes(summary.totalTimeInBed)})`),
                        CardText(`HRV (daily RMSSD): ${summary.hrvDailyRmssd ?? "n/a"} ms`),
                        CardText(`Tiefste Herzfrequenz: ${summary.lowestHeartRate ?? "n/a"} bpm`)
                    ]
                })
            )
        } catch (error) {
            if (await handleFitbitAuthorizationError(ctx.thread, error)) return
            await postThreadError(ctx.thread, error, "Fitbit konnte nicht geladen werden")
        }
    }
}

export const fitbit = new Command(fitbitCommand)
