import type { Hono } from "hono"
import { runDailyBriefing } from "../lib/briefing.js"

export function registerJobRoutes(app: Hono) {
    app.get("/api/jobs/daily-briefing", async (c) => {
        const authHeader = c.req.header("authorization")
        const querySecret = c.req.query("key")
        const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET
        if (!isAuthorized) return c.text("Unauthorized", 401)

        try {
            const result = await runDailyBriefing()
            return c.json({ ok: true, ...result }, 200)
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            return c.json({ ok: false, error: details }, 500)
        }
    })
}
