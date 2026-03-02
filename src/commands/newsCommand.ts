import { Actions, Card, CardLink, CardText, LinkButton } from "chat"
import { getNewsSummaryMessage } from "../lib/news.js"
import { Command, type CommandDefinition } from "../types/command.js"

const newsCommand: CommandDefinition<"news"> = {
    name: "news",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        try {
            const summary = await getNewsSummaryMessage()

            await ctx.thread.post(
                Card({
                    title: `News (${summary.items.length} Meldungen)`,
                    children: [
                        ...summary.items.map((item, index) =>
                            CardLink({ url: item.link, label: `${index + 1}. [${item.category}] ${item.title}` })
                        ),
                        ...(summary.errors.length > 0
                            ? [CardText(`Hinweis: ${summary.errors.length} Feed(s) konnten nicht geladen werden.`)]
                            : [])
                    ]
                })
            )
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`News konnten nicht geladen werden: ${details}`)
        }
    }
}

export const news = new Command(newsCommand)
