import {
    FitbitAuthorizationRequiredError,
    createFitbitAuthorizationUrl,
    getFitbitDailySummaryMessage
} from "../lib/fitbit.js"
import { Command, type CommandInit } from "../types/command-base.js"

type FitbitArgs = [] | [action: "login" | "summary"]

const fitbitCommand: CommandInit<"fitbit", FitbitArgs> = {
    name: "fitbit",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        const action = ctx.args[0]
        if (!action) {
            await ctx.thread.post(
                "Fitbit Subcommands:\n" +
                "- /fitbit login\n" +
                "- /fitbit summary"
            )
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createFitbitAuthorizationUrl(ctx.message.author.userId)
                await ctx.thread.post(`Bitte verbinde Fitbit hier: ${authorizationUrl}`)
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`Fitbit Login konnte nicht gestartet werden: ${details}`)
            }
            return
        }

        if (action !== "summary") {
            await ctx.thread.post("Unbekannter Fitbit-Subcommand. Erlaubt: login, summary")
            return
        }

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

export const fitbit = new Command(fitbitCommand)
