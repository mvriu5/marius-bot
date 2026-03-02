import { Actions, Button, Card, CardText } from "chat"
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

            const statusLines = [
                `Fitbit: ${fitbitConnected ? "✅" : "🚫"}`,
                `Google Calendar: ${googleConnected ? "✅" : "🚫"}`
            ]

            const loginButtons = [
                !fitbitConnected && Button({ id: "command:fitbit:login", label: "Fitbit verbinden", value: "fitbit login" }),
                !googleConnected && Button({ id: "command:meetings:login", label: "Google verbinden", value: "meetings login" })
            ]
            const availableLoginButtons = loginButtons.filter((button): button is Exclude<typeof button, false> => Boolean(button))

            await ctx.thread.post(
                Card({
                    title: "Account Verbindungen",
                    children: [
                        CardText(statusLines.join("\n")),
                        ...(availableLoginButtons.length > 0
                            ? [
                                CardText("Nicht verbundene Dienste:"),
                                Actions(availableLoginButtons)
                            ]
                            : [CardText("✅ Alle Dienste sind verbunden.")])
                    ]
                })
            )
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`⚠️ Account-Status konnte nicht geladen werden: ${details}`)
        }
    }
}

export const account = new Command(accountCommand)
