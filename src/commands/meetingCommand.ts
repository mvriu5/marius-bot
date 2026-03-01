import {
    GoogleAuthorizationRequiredError,
    createGoogleAuthorizationUrl,
    getTodayCalendarSummaryMessage
} from "../lib/googleCalendar.js"
import { Command, type CommandDefinition } from "../types/command.js"

type MeetingArgs = [] | [action: "login" | "summary"]

const meetingCommand: CommandDefinition<"meetings", MeetingArgs> = {
    name: "meetings",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        const action = ctx.args[0]
        if (!action) {
            await ctx.thread.post(
                "Meetings Subcommands:\n" +
                "- /meetings login\n" +
                "- /meetings summary"
            )
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createGoogleAuthorizationUrl(ctx.message.author.userId)
                await ctx.thread.post(`Bitte verbinde Google Calendar hier: ${authorizationUrl}`)
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`Google Login konnte nicht gestartet werden: ${details}`)
            }
            return
        }

        if (action !== "summary") {
            await ctx.thread.post("Unbekannter Meetings-Subcommand. Erlaubt: login, summary")
            return
        }

        try {
            const summary = await getTodayCalendarSummaryMessage(ctx.message.author.userId)
            await ctx.thread.post(summary)
        } catch (error) {
            if (error instanceof GoogleAuthorizationRequiredError) {
                await ctx.thread.post(`Bitte verbinde zuerst Google Calendar: ${error.authorizationUrl}`)
                return
            }

            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`Meetings konnten nicht geladen werden: ${details}`)
        }
    }
}

export const meetings = new Command(meetingCommand)
