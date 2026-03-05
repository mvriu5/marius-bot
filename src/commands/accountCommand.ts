import { Actions, Button, Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { isFitbitConnected } from "../lib/fitbit.js"
import { isGithubConnected } from "../lib/github.js"
import { isGoogleCalendarConnected } from "../lib/googleCalendar.js"
import { isNotionConnected } from "../lib/notion.js"
import { isNotionMcpConnected } from "../lib/notionMcp.js"
import { Command, type CommandDefinition } from "../types/command.js"

const accountCommand: CommandDefinition<"account", {}> = {
    name: "account",
    argPolicy: { type: "none" },
    parseArgs: () => ({ ok: true, value: {} }),
    execute: async (ctx) => {
        try {
            const userId = ctx.message.author.userId
            const [fitbitConnected, googleConnected, githubConnected, notionConnected, notionMcpConnected] = await Promise.all([
                isFitbitConnected(userId),
                isGoogleCalendarConnected(userId),
                isGithubConnected(userId),
                isNotionConnected(userId),
                isNotionMcpConnected(userId)
            ])

            const statusLines = [
                `Fitbit: ${fitbitConnected ? "yes" : "no"}`,
                `Google Calendar: ${googleConnected ? "yes" : "no"}`,
                `GitHub: ${githubConnected ? "yes" : "no"}`,
                `Notion: ${notionConnected ? "yes" : "no"}`,
                `Notion MCP: ${notionMcpConnected ? "yes" : "no"}`
            ]

            const loginButtons = [
                !fitbitConnected && Button({ id: "command:fitbit:login", label: "Connect Fitbit", value: "fitbit login" }),
                !googleConnected && Button({ id: "command:meetings:login", label: "Connect Google", value: "meetings login" }),
                !githubConnected && Button({ id: "command:github:login", label: "Connect GitHub", value: "github login" }),
                !notionConnected && Button({ id: "command:notion:login", label: "Connect Notion", value: "notion login" }),
                !notionMcpConnected && Button({ id: "command:notion:mcp-login", label: "Connect Notion MCP", value: "notion mcp-login" })
            ]
            const availableLoginButtons = loginButtons.filter((button): button is Exclude<typeof button, false> => Boolean(button))

            await ctx.thread.post(
                Card({
                    title: "Account Verbindungen",
                    children: [
                        ...(availableLoginButtons.length > 0
                            ? [
                                CardText(statusLines.join("\n")),
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
