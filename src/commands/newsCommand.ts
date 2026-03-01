import { getNewsSummaryMessage } from "../lib/news.js"
import { Command, type CommandDefinition } from "../types/command.js"

const newsCommand: CommandDefinition<"news"> = {
    name: "news",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        try {
            const summary = await getNewsSummaryMessage()
            await ctx.thread.post(summary)
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`News konnten nicht geladen werden: ${details}`)
        }
    }
}

export const news = new Command(newsCommand)
