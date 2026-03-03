import { Actions, Button, Card, CardText, LinkButton } from "chat"
import {
    GoogleAuthorizationRequiredError,
    createGoogleAuthorizationUrl,
    getTodayCalendarEventsSummary,
    isGoogleCalendarConnected
} from "../lib/googleCalendar.js"
import { Command, type CommandDefinition } from "../types/command.js"

type MeetingsAction = "menu" | "login" | "summary"
type MeetingsParsedArgs = {
    action: MeetingsAction
}

const meetingCommand: CommandDefinition<"meetings", MeetingsParsedArgs> = {
    name: "meetings",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => {
        const action = args[0]
        if (!action) return { ok: true, value: { action: "menu" as const } }
        if (action === "login" || action === "summary") {
            return { ok: true, value: { action } }
        }
        return { ok: false, message: "Unbekannter Meetings-Subcommand" }
    },
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs
        if (action === "menu") {
            const userId = ctx.message.author.userId
            const connected = await isGoogleCalendarConnected(userId)

            if (!connected) {
                try {
                    const authorizationUrl = await createGoogleAuthorizationUrl(userId)
                    await ctx.thread.post(
                        Card({
                            title: "Google Login",
                            children: [
                                CardText("Bitte verbinde zuerst Google Calendar:"),
                                Actions([
                                    LinkButton({ url: authorizationUrl, label: "Login" })
                                ])
                            ]
                        })
                    )
                } catch (error) {
                    const details = error instanceof Error ? error.message : String(error)
                    await ctx.thread.post(`⚠️ Google Login konnte nicht gestartet werden: ${details}`)
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
                                id: "command:meetings:summary",
                                label: "🗒️ Summary",
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
                await ctx.thread.post(
                    Card({
                        title: "Google Login",
                        children: [
                            CardText("Bitte verbinde Google Calendar hier:"),
                            Actions([
                                LinkButton({ url: authorizationUrl, label: "Login" })
                            ])
                        ]
                    })
                )

            } catch (error) {
                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`⚠️ Google Login konnte nicht gestartet werden: ${details}`)
            }
            return
        }

        try {
            const summary = await getTodayCalendarEventsSummary(ctx.message.author.userId)
            await ctx.thread.post(summary)
        } catch (error) {
            if (error instanceof GoogleAuthorizationRequiredError) {
                await ctx.thread.post(
                    Card({
                        title: "Google Login",
                        children: [
                            CardText("Bitte verbinde zuerst Google Calendar:"),
                            Actions([
                                LinkButton({ url: error.authorizationUrl, label: "Login" })
                            ])
                        ]
                    })
                )
                return
            }

            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`⚠️ Meetings konnten nicht geladen werden: ${details}`)
        }
    }
}

export const meetings = new Command(meetingCommand)
