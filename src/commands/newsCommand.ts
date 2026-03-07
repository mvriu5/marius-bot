import { Actions, Card, CardText, LinkButton } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { parseNoArgs } from "../lib/commandParsers.js"
import { getTodayNews } from "../integrations/news.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { defineCommandModule } from "./shared/module.js"

const newsCommand: CommandDefinition<"news", {}> = {
    name: "news",
    argPolicy: { type: "none" },
    parseArgs: parseNoArgs,
    execute: async (ctx) => {
        try {
            const summary = await getTodayNews()
            const titleLines = summary.items.map((item, index) => `${index + 1}. [${item.category}] - ${item.title}`)

            await ctx.thread.post(
                Card({
                    title: `🗞️ News (${summary.items.length} Meldungen)`,
                    children: [
                        ...titleLines.map((line) => CardText(line)),
                        Actions(
                            summary.items.map((item, index) =>
                                LinkButton({
                                    label: `${index + 1}`,
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
            await postThreadError(ctx.thread, error, "News konnten nicht geladen werden")
        }
    }
}

export const news = createCommand(newsCommand)

export const newsModule = defineCommandModule({
    command: news,
    description: "Liest die aktuellen News-Feeds.",
    aliases: [] as const,
    subcommands: [] as const,
    actionIds: [] as const
})
