import { Actions, Button, Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import {
    FitbitAuthorizationRequiredError,
    createFitbitAuthorizationUrl,
    getFitbitActivityData,
    getFitbitData,
    getFitbitWeekActivityData,
    isFitbitConnected
} from "../integrations/fitbit.js"
import { formatMinutesCompact } from "../lib/dateTimeFormat.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { postOAuthLoginCard } from "../ui/oauthCards.js"
import { parseMenuActionArgs } from "../lib/commandArgs.js"
import { ACTION_IDS } from "./shared/actionIds.js"
import { defineCommandModule } from "./shared/module.js"

type FitbitAction = "menu" | "login" | "summary" | "activity" | "week"
type FitbitParsedArgs = {
    action: FitbitAction
}

async function handleFitbitAuthorizationError(
    thread: Parameters<typeof postOAuthLoginCard>[0],
    error: unknown
) {
    if (!(error instanceof FitbitAuthorizationRequiredError)) return false
    await postOAuthLoginCard(thread, {
        title: "Fitbit Login",
        text: "Bitte verbinde zuerst Fitbit:",
        authorizationUrl: error.authorizationUrl
    })
    return true
}

const fitbitCommand: CommandDefinition<"fitbit", FitbitParsedArgs> = {
    name: "fitbit",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => parseMenuActionArgs(args, {
        defaultAction: "menu",
        allowedActions: ["login", "summary", "activity", "week"] as const,
        unknownActionMessage: "Unbekannter Fitbit-Subcommand"
    }),
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs
        if (action === "menu") {
            const userId = ctx.message.author.userId
            const connected = await isFitbitConnected(userId)

            if (!connected) {
                try {
                    const authorizationUrl = await createFitbitAuthorizationUrl(userId)
                    await postOAuthLoginCard(ctx.thread, {
                        title: "Fitbit Login",
                        text: "Bitte verbinde zuerst Fitbit:",
                        authorizationUrl
                    })
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
                                id: ACTION_IDS.fitbit.summary,
                                label: "Summary",
                                value: "fitbit summary"
                            }),
                            Button({
                                id: ACTION_IDS.fitbit.activity,
                                label: "Activity",
                                value: "fitbit activity"
                            }),
                            Button({
                                id: ACTION_IDS.fitbit.week,
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
                await postOAuthLoginCard(ctx.thread, {
                    title: "Fitbit Login",
                    text: "Bitte verbinde Fitbit hier:",
                    authorizationUrl
                })
            } catch (error) {
                await postThreadError(ctx.thread, error, "Fitbit Login konnte nicht gestartet werden")
            }
            return
        }

        if (action === "activity") {
            try {
                const activity = await getFitbitActivityData(ctx.message.author.userId)

                await ctx.thread.post(
                    Card({
                        title: "Fitbit Aktivität Heute",
                        children: [
                            CardText(`Schritte: ${activity.steps}`),
                            CardText(`Distanz: ${activity.distanceKm.toFixed(2)} km`),
                            CardText(`Kalorien: ${activity.caloriesOut}`),
                            CardText(`Stockwerke: ${activity.floors}`),
                            CardText(
                                `Aktive Minuten: ${formatMinutesCompact(activity.activeMinutes)} `
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

            await ctx.thread.post(
                Card({
                    title: "Fitbit Tagesübersicht",
                    children: [
                        CardText(`Schlaf: ${formatMinutesCompact(summary.totalMinutesAsleep)} (im Bett: ${formatMinutesCompact(summary.totalTimeInBed)})`),
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

export const fitbit = createCommand(fitbitCommand)

export const fitbitModule = defineCommandModule({
    command: fitbit,
    description: "Zeigt Fitbit-Daten und Login-Optionen.",
    aliases: ["fb"] as const,
    subcommands: ["login", "summary", "activity", "week"] as const,
    actionIds: [ACTION_IDS.fitbit.login, ACTION_IDS.fitbit.summary, ACTION_IDS.fitbit.activity, ACTION_IDS.fitbit.week] as const
})
