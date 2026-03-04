import { Actions, Card, CardText, LinkButton, type Thread } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { createNotionAuthorizationUrl, isNotionConnected } from "../lib/notion.js"
import { Command, type CommandDefinition } from "../types/command.js"

type NotionAction = "menu" | "login"
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
        if (action === "login") return { ok: true, value: { action } }
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
                        CardText("Notion ist verbunden."),
                    ]
                })
            )
            return
        }

        try {
            const authorizationUrl = await createNotionAuthorizationUrl(userId)
            await postNotionLoginCard(ctx.thread, authorizationUrl, "Bitte verbinde Notion hier:")
        } catch (error) {
            await postThreadError(ctx.thread, error, "Notion Login konnte nicht gestartet werden")
        }
    }
}

export const notion = new Command(notionCommand)
