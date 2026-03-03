import { Card, CardText, Divider } from "chat"
import { getPlausibleLast24HoursAnalytics } from "../lib/plausible.js"
import { Command, type CommandDefinition } from "../types/command.js"

type AnalyticsParsedArgs = {
    siteQuery?: string
}

const analyticsCommand: CommandDefinition<"analytics", AnalyticsParsedArgs> = {
    name: "analytics",
    argPolicy: { type: "any" },
    parseArgs: (args) => {
        const siteQuery = args.join(" ").trim()
        return { ok: true, value: { siteQuery: siteQuery || undefined } }
    },
    execute: async (ctx) => {
        try {
            const summary = await getPlausibleLast24HoursAnalytics(ctx.parsedArgs.siteQuery)

            const formatPercent = (value: number | null) =>
                value === null || Number.isNaN(value) ? "n/a" : `${value.toFixed(1)}%`

            const formatSeconds = (value: number | null) => {
                if (value === null || Number.isNaN(value)) return "n/a"
                const rounded = Math.round(value)
                const mins = Math.floor(rounded / 60)
                const secs = rounded % 60
                if (mins <= 0) return `${secs}s`
                return `${mins}m ${secs}s`
            }

            await ctx.thread.post(
                Card({
                    title: "Website Analytics (letzte 24h)",
                    children: [
                        ...summary.sites.flatMap((site, index) => [
                            CardText(`🏷️ Site: ${site.label} (${site.siteId})`),
                            CardText(`👤 Visitors: ${site.metrics.visitors}`),
                            CardText(`📈 Pageviews: ${site.metrics.pageviews}`),
                            CardText(`📉 Bounce Rate: ${formatPercent(site.metrics.bounceRatePct)}`),
                            CardText(`🕓 Visit Duration: ${formatSeconds(site.metrics.visitDurationSec)}`),
                            ...(index < summary.sites.length - 1 ? [Divider()] : [])
                        ]),
                        ...(summary.errors.length > 0
                            ? [Divider(), CardText(`Hinweis: ${summary.errors.length} Site(s) konnten nicht geladen werden.`)]
                            : [])
                    ]
                })
            )
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`Analytics konnten nicht geladen werden: ${details}`)
        }
    }
}

export const analytics = new Command(analyticsCommand)
