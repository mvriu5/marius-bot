import { isFitbitConnected } from "../lib/fitbit.js"
import { isGoogleCalendarConnected } from "../lib/googleCalendar.js"
import { Command, type CommandDefinition } from "../types/command.js"

const accountCommand: CommandDefinition<"account"> = {
    name: "account",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        try {
            const userId = ctx.message.author.userId
            const [fitbitConnected, googleConnected] = await Promise.all([
                isFitbitConnected(userId),
                isGoogleCalendarConnected(userId)
            ])

            const lines = [
                "Account Verbindungen:",
                `- Fitbit: ${fitbitConnected ? "verbunden" : "nicht verbunden"}`,
                `- Google Calendar: ${googleConnected ? "verbunden" : "nicht verbunden"}`
            ]

            await ctx.thread.post(lines.join("\n"))
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`Account-Status konnte nicht geladen werden: ${details}`)
        }
    }
}

export const account = new Command(accountCommand)
