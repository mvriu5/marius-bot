import { Actions, Button, Card, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { NotionAuthorizationRequiredError, createNotionAuthorizationUrl, getNotionPages, isNotionConnected } from "../integrations/notion.js"
import { createNotionMcpAuthorizationUrl, isNotionMcpConnected } from "../integrations/notionMcp.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { parseMenuActionArgs } from "../lib/commandArgs.js"
import { ACTION_IDS } from "./shared/actionIds.js"
import { postOAuthLoginCard } from "../ui/oauthCards.js"
import { definedButtons } from "../ui/buttons.js"
import { defineCommandModule } from "./shared/module.js"

type NotionAction = "menu" | "login" | "pages" | "mcp-login"
type NotionParsedArgs = {
    action: NotionAction
}

const notionCommand: CommandDefinition<"notion", NotionParsedArgs> = {
    name: "notion",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => parseMenuActionArgs(args, {
        defaultAction: "menu",
        allowedActions: ["login", "pages", "mcp-login"] as const,
        unknownActionMessage: "Unbekannter Notion-Subcommand"
    }),
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs
        const userId = ctx.message.author.userId

        if (action === "menu") {
            try {
                const [notionConnected, notionMcpConnected] = await Promise.all([
                    isNotionConnected(userId),
                    isNotionMcpConnected(userId)
                ])

                const status = [
                    `Notion Integration: ${notionConnected ? "verbunden" : "nicht verbunden"}`,
                    `Notion MCP: ${notionMcpConnected ? "verbunden" : "nicht verbunden"}`
                ].join("\n")

                const buttons = [
                    !notionConnected && Button({ id: ACTION_IDS.notion.login, label: "Notion Login", value: "notion login" }),
                    notionConnected && Button({ id: ACTION_IDS.notion.pages, label: "Pages", value: "notion pages" }),
                    !notionMcpConnected && Button({ id: ACTION_IDS.notion.mcpLogin, label: "MCP Login", value: "notion mcp-login" })
                ]
                const availableButtons = definedButtons(buttons)

                await ctx.thread.post(
                    Card({
                        title: "Notion",
                        children: [
                            CardText(status),
                            ...(availableButtons.length > 0 ? [Actions(availableButtons)] : [CardText("Alle Notion-Verbindungen sind aktiv.")])
                        ]
                    })
                )
            } catch (error) {
                await postThreadError(ctx.thread, error, "Notion Status konnte nicht geladen werden")
            }
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createNotionAuthorizationUrl(userId)
                await postOAuthLoginCard(ctx.thread, {
                    title: "Notion Login",
                    text: "Bitte verbinde Notion hier:",
                    authorizationUrl
                })
            } catch (error) {
                await postThreadError(ctx.thread, error, "Notion Login konnte nicht gestartet werden")
            }
            return
        }

        if (action === "mcp-login") {
            try {
                const authorizationUrl = await createNotionMcpAuthorizationUrl(userId)
                await postOAuthLoginCard(ctx.thread, {
                    title: "Notion MCP Login",
                    text: "Bitte verbinde Notion MCP hier:",
                    authorizationUrl
                })
            } catch (error) {
                await postThreadError(ctx.thread, error, "Notion MCP Login konnte nicht gestartet werden")
            }
            return
        }

        try {
            const pages = await getNotionPages(userId)
            await ctx.thread.post(
                Card({
                    title: "Notion Pages",
                    children: pages.length === 0
                        ? [
                            CardText("Keine Notion-Seiten gefunden."),
                            CardText("Hinweis: Teile deine Notion-Seiten mit der Integration, damit der Agent darauf zugreifen kann.")
                        ]
                        : [
                            CardText(`${pages.length} Seite(n) gefunden:`),
                            ...pages.map((page, index) =>
                                CardText(`${index + 1}. ${page.title}${page.url ? ` - ${page.url}` : ""}`)
                            ),
                            CardText("Hinweis: Fehlende Seiten? Teile sie in Notion direkt mit dieser Integration.")
                        ]
                })
            )
        } catch (error) {
            if (error instanceof NotionAuthorizationRequiredError) {
                await postOAuthLoginCard(ctx.thread, {
                    title: "Notion Login",
                    text: "Bitte verbinde zuerst Notion:",
                    authorizationUrl: error.authorizationUrl
                })
                return
            }
            await postThreadError(ctx.thread, error, "Notion Pages konnten nicht geladen werden")
        }
    }
}

export const notion = createCommand(notionCommand)

export const notionModule = defineCommandModule({
    command: notion,
    description: "Verwaltet Notion-Integration (Login, Seitenauflistung).",
    aliases: [] as const,
    subcommands: ["login", "mcp-login", "pages"] as const,
    actionIds: [ACTION_IDS.notion.login, ACTION_IDS.notion.mcpLogin, ACTION_IDS.notion.pages] as const
})
