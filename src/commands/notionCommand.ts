import { Actions, Button, Card, CardLink, CardText, LinkButton, type Thread } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { NotionAuthorizationRequiredError, createNotionAuthorizationUrl, getNotionPages, isNotionConnected } from "../lib/notion.js"
import { Command, type CommandDefinition } from "../types/command.js"

type NotionAction = "menu" | "login" | "pages"
type NotionParsedArgs = {
    action: NotionAction
}

async function postNotionLoginCard(
    thread: Thread<Record<string, unknown>, unknown>,
    authorizationUrl: string,
    text = "Bitte verbinde zuerst Notion:"
) {
    await thread.post(
        Card({
            title: "Notion Login",
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
        if (action === "login" || action === "pages") return { ok: true, value: { action } }
        return { ok: false, message: "Unbekannter Notion-Subcommand" }
    },
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs
        const userId = ctx.message.author.userId

        if (action === "menu") {
            const connected = await isNotionConnected(userId)
            if (!connected) {
                try {
                    const authorizationUrl = await createNotionAuthorizationUrl(userId)
                    await postNotionLoginCard(ctx.thread, authorizationUrl)
                } catch (error) {
                    await postThreadError(ctx.thread, error, "Notion Login konnte nicht gestartet werden")
                }
                return
            }

            await ctx.thread.post(
                Card({
                    title: "Notion",
                    children: [
                        CardText("Wähle ein Subcommand:"),
                        Actions([
                            Button({ id: "command:notion:pages", label: "Pages", value: "notion pages" })
                        ])
                    ]
                })
            )
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createNotionAuthorizationUrl(userId)
                await postNotionLoginCard(ctx.thread, authorizationUrl, "Bitte verbinde Notion hier:")
            } catch (error) {
                await postThreadError(ctx.thread, error, "Notion Login konnte nicht gestartet werden")
            }
            return
        }

        try {
            const pages = await getNotionPages(userId)
            await ctx.thread.post(
                Card({
                    title: "Notion Pages",
                    children: pages.length === 0
                        ? [CardText("Keine Notion-Seiten gefunden.")]
                        : pages.map((page, index) =>
                            CardLink({
                                url: page.url,
                                label: `${index + 1}. ${page.title}`
                            })
                        )
                })
            )
        } catch (error) {
            if (error instanceof NotionAuthorizationRequiredError) {
                await postNotionLoginCard(ctx.thread, error.authorizationUrl)
                return
            }
            await postThreadError(ctx.thread, error, "Notion Pages konnten nicht geladen werden")
        }
    }
}

export const notion = new Command(notionCommand)
