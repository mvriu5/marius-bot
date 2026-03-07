import { Card, CardText, Divider } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { parseOptionalJoinedArg } from "../lib/commandParsers.js"
import { formatPercent, formatSecondsHuman } from "../lib/dateTimeFormat.js"
import { getPlausibleLast24HoursAnalytics } from "../integrations/plausible.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { defineCommandModule } from "./shared/module.js"

type AnalyticsParsedArgs = {
    siteQuery?: string
}

const analyticsCommand: CommandDefinition<"analytics", AnalyticsParsedArgs> = {
    name: "analytics",
    argPolicy: { type: "any" },
    parseArgs: (args) => parseOptionalJoinedArg(args, "siteQuery"),
    execute: async (ctx) => {
        try {
            const summary = await getPlausibleLast24HoursAnalytics(ctx.parsedArgs.siteQuery)

            await ctx.thread.post(
                Card({
                    title: "🔔 Website Analytics (letzte 24h)",
                    children: [
                        ...summary.sites.flatMap((site, index) => [
                            CardText(`📌 Site: ${site.label} (${site.siteId})`),
                            CardText(`🔎 Visitors: ${site.metrics.visitors}`),
                            CardText(`📈 Pageviews: ${site.metrics.pageviews}`),
                            CardText(`📉 Bounce Rate: ${formatPercent(site.metrics.bounceRatePct)}`),
                            CardText(`🕤 Visit Duration: ${formatSecondsHuman(site.metrics.visitDurationSec)}`),
                            ...(index < summary.sites.length - 1 ? [Divider()] : [])
                        ]),
                        ...(summary.errors.length > 0
                            ? [Divider(), CardText(`Hinweis: ${summary.errors.length} Site(s) konnten nicht geladen werden.`)]
                            : [])
                    ]
                })
            )
        } catch (error) {
            await postThreadError(ctx.thread, error, "Analytics konnten nicht geladen werden")
        }
    }
}

export const analytics = createCommand(analyticsCommand)

export const analyticsModule = defineCommandModule({
    command: analytics,
    description: "Zeigt Website-Analytics der letzten 24 Stunden.",
    aliases: [] as const,
    subcommands: ["<site (optional)>"] as const,
    actionIds: [] as const
})
