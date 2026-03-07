import { Actions, Button, Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { isFitbitConnected } from "../integrations/fitbit.js"
import { isGithubConnected } from "../integrations/github.js"
import { isGoogleCalendarConnected } from "../integrations/googleCalendar.js"
import { isNotionConnected } from "../integrations/notion.js"
import { isNotionMcpConnected } from "../integrations/notionMcp.js"
import { parseNoArgs } from "../lib/commandParsers.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { ACTION_IDS } from "./shared/actionIds.js"
import { defineCommandModule } from "./shared/module.js"
import { definedButtons } from "../ui/buttons.js"

const accountCommand: CommandDefinition<"account", {}> = {
    name: "account",
    argPolicy: { type: "none" },
    parseArgs: parseNoArgs,
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
                !fitbitConnected && Button({ id: ACTION_IDS.fitbit.login, label: "Connect Fitbit", value: "fitbit login" }),
                !googleConnected && Button({ id: ACTION_IDS.meetings.login, label: "Connect Google", value: "meetings login" }),
                !githubConnected && Button({ id: ACTION_IDS.github.login, label: "Connect GitHub", value: "github login" }),
                !notionConnected && Button({ id: ACTION_IDS.notion.login, label: "Connect Notion", value: "notion login" }),
                !notionMcpConnected && Button({ id: ACTION_IDS.notion.mcpLogin, label: "Connect Notion MCP", value: "notion mcp-login" })
            ]
            const availableLoginButtons = definedButtons(loginButtons)

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

export const account = createCommand(accountCommand)

export const accountModule = defineCommandModule({
    command: account,
    description: "Zeigt den Verbindungsstatus aller Integrationen.",
    aliases: ["acc"] as const,
    subcommands: [] as const,
    actionIds: [] as const
})
