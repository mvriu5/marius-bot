import { Actions, Card, CardText, Divider, LinkButton } from "chat"
import { getTodayNews } from "../lib/news.js"
import { Command, type CommandDefinition } from "../types/command.js"

const newsCommand: CommandDefinition<"news"> = {
    name: "news",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        try {
            const summary = await getTodayNews()
            const titleLines = summary.items.map((item, index) => `${index + 1}. [${item.category}] - ${item.title}`)

            await ctx.thread.post(
                Card({
                    title: `🗞️ News (${summary.items.length} Meldungen)`,
                    children: [
                        ...(titleLines.map((line) =>
                            CardText(line),
                            Divider()
                        )),
                        Actions(
                            summary.items.map((item, index) =>
                                LinkButton({
                                    label: `${index + 1}.`,
                                    url: item.link
                                })
                            )
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
