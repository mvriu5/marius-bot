import { Actions, Button, Card, CardText, LinkButton, type Thread } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { NotionAuthorizationRequiredError, createNotionAuthorizationUrl, getNotionPages, isNotionConnected } from "../lib/notion.js"
import { createNotionMcpAuthorizationUrl, isNotionMcpConnected } from "../lib/notionMcp.js"
import { Command, type CommandDefinition } from "../types/command.js"

type NotionAction = "menu" | "login" | "pages" | "mcp-login"
type NotionParsedArgs = {
    action: NotionAction
}

async function postNotionLoginCard(
    thread: Thread<Record<string, unknown>, unknown>,
    authorizationUrl: string,
    title: string,
    text: string
) {
    await thread.post(
        Card({
            title,
            children: [
                CardText(text),
                Actions([LinkButton({ url: authorizationUrl, label: "Login" })])
            ]
        })
    )
}

const notionCommand: CommandDefinition<"notion", NotionParsedArgs> = {
    name: "notion",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => {
        const action = args[0]
        if (!action) return { ok: true, value: { action: "menu" as const } }
        if (action === "login" || action === "pages" || action === "mcp-login") return { ok: true, value: { action } }
        return { ok: false, message: "Unbekannter Notion-Subcommand" }
    },
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
                    !notionConnected && Button({ id: "command:notion:login", label: "Notion Login", value: "notion login" }),
                    notionConnected && Button({ id: "command:notion:pages", label: "Pages", value: "notion pages" }),
                    !notionMcpConnected && Button({ id: "command:notion:mcp-login", label: "MCP Login", value: "notion mcp-login" })
                ]
                const availableButtons = buttons.filter((item): item is Exclude<typeof item, false> => Boolean(item))

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
                await postNotionLoginCard(
                    ctx.thread,
                    authorizationUrl,
                    "Notion Login",
                    "Bitte verbinde Notion hier:"
                )
            } catch (error) {
                await postThreadError(ctx.thread, error, "Notion Login konnte nicht gestartet werden")
            }
            return
        }

        if (action === "mcp-login") {
            try {
                const authorizationUrl = await createNotionMcpAuthorizationUrl(userId)
                await postNotionLoginCard(
                    ctx.thread,
                    authorizationUrl,
                    "Notion MCP Login",
                    "Bitte verbinde Notion MCP hier:"
                )
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
                await postNotionLoginCard(
                    ctx.thread,
                    error.authorizationUrl,
                    "Notion Login",
                    "Bitte verbinde zuerst Notion:"
                )
                return
            }
            await postThreadError(ctx.thread, error, "Notion Pages konnten nicht geladen werden")
        }
    }
}

export const notion = new Command(notionCommand)
