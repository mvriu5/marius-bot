import { Actions, Button, Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import {
    GoogleAuthorizationRequiredError,
    createGoogleAuthorizationUrl,
    getTodayCalendarEventsSummary,
    isGoogleCalendarConnected
} from "../integrations/googleCalendar.js"
import { parseMenuActionArgs } from "../lib/commandArgs.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { ACTION_IDS } from "./shared/actionIds.js"
import { postOAuthLoginCard } from "../ui/oauthCards.js"
import { defineCommandModule } from "./shared/module.js"

type MeetingsAction = "menu" | "login" | "summary"
type MeetingsParsedArgs = {
    action: MeetingsAction
}

const meetingCommand: CommandDefinition<"meetings", MeetingsParsedArgs> = {
    name: "meetings",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => parseMenuActionArgs(args, {
        defaultAction: "menu",
        allowedActions: ["login", "summary"] as const,
        unknownActionMessage: "Unbekannter Meetings-Subcommand"
    }),
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs
        if (action === "menu") {
            const userId = ctx.message.author.userId
            const connected = await isGoogleCalendarConnected(userId)

            if (!connected) {
                try {
                    const authorizationUrl = await createGoogleAuthorizationUrl(userId)
                    await postOAuthLoginCard(ctx.thread, {
                        title: "Google Login",
                        text: "Bitte verbinde zuerst Google Calendar:",
                        authorizationUrl
                    })
                } catch (error) {
                    await postThreadError(ctx.thread, error, "Google Login konnte nicht gestartet werden")
                }
                return
            }

            await ctx.thread.post(
                Card({
                    title: "Meetings",
                    children: [
                        CardText("Wähle einen Subcommand:"),
                        Actions([
                            Button({
                                id: ACTION_IDS.meetings.summary,
                                label: "Summary",
                                value: "meetings summary"
                            })
                        ])
                    ]
                })
            )
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createGoogleAuthorizationUrl(ctx.message.author.userId)
                await postOAuthLoginCard(ctx.thread, {
                    title: "Google Login",
                    text: "Bitte verbinde Google Calendar hier:",
                    authorizationUrl
                })
            } catch (error) {
                await postThreadError(ctx.thread, error, "Google Login konnte nicht gestartet werden")
            }
            return
        }

        try {
            const summary = await getTodayCalendarEventsSummary(ctx.message.author.userId)
            await ctx.thread.post(summary)
        } catch (error) {
            if (error instanceof GoogleAuthorizationRequiredError) {
                await postOAuthLoginCard(ctx.thread, {
                    title: "Google Login",
                    text: "Bitte verbinde zuerst Google Calendar:",
                    authorizationUrl: error.authorizationUrl
                })
                return
            }

            await postThreadError(ctx.thread, error, "Meetings konnten nicht geladen werden")
        }
    }
}

export const meetings = createCommand(meetingCommand)

export const meetingsModule = defineCommandModule({
    command: meetings,
    description: "Zeigt heutige Kalender-Meetings.",
    aliases: ["meeting", "calendar", "schedule"] as const,
    subcommands: ["login", "summary"] as const,
    actionIds: [ACTION_IDS.meetings.login, ACTION_IDS.meetings.summary] as const
})
