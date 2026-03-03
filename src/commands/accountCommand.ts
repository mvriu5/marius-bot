import { Actions, Button, Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { isFitbitConnected } from "../lib/fitbit.js"
import { isGithubConnected } from "../lib/github.js"
import { isGoogleCalendarConnected } from "../lib/googleCalendar.js"
import { Command, type CommandDefinition } from "../types/command.js"

const accountCommand: CommandDefinition<"account", {}> = {
    name: "account",
    argPolicy: { type: "none" },
    parseArgs: () => ({ ok: true, value: {} }),
    execute: async (ctx) => {
        try {
            const userId = ctx.message.author.userId
            const [fitbitConnected, googleConnected, githubConnected] = await Promise.all([
                isFitbitConnected(userId),
                isGoogleCalendarConnected(userId),
                isGithubConnected(userId)
            ])

            const statusLines = [
                `Fitbit: ${fitbitConnected ? "[x]" : "[ ]"}`,
                `Google Calendar: ${googleConnected ? "[x]" : "[ ]"}`,
                `GitHub: ${githubConnected ? "[x]" : "[ ]"}`
            ]

            const loginButtons = [
                !fitbitConnected && Button({ id: "command:fitbit:login", label: "Connect Fitbit", value: "fitbit login" }),
                !googleConnected && Button({ id: "command:meetings:login", label: "Connect Google", value: "meetings login" }),
                !githubConnected && Button({ id: "command:github:login", label: "Connect GitHub", value: "github login" })
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
                            : [CardText("Alle Dienste sind verbunden.")])
                    ]
                })
            )
        } catch (error) {
            await postThreadError(ctx.thread, error, "Account-Status konnte nicht geladen werden")
        }
    }
}

export const account = new Command(accountCommand)
