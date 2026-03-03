import type { Hono } from "hono"
import { logError, toHttpError } from "../errors/errorOutput.js"
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
            logError("jobs.daily-briefing", error)
            const httpError = toHttpError(error)
            return c.json(httpError.body, httpError.status)
        }
    })
}
