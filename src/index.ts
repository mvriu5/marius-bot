import { Hono } from 'hono'
import { bot } from "./bot.js"
import { runDailyBriefing } from "./briefing.js"
import { createFitbitAuthorizationUrl, handleFitbitOAuthCallback } from "./lib/fitbit.js"

const app = new Hono()

app.get("/", (c) => c.text("Bot is running"))

app.get("/api/jobs/daily-briefing", async (c) => {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return c.text("Missing CRON_SECRET", 500)

    const authHeader = c.req.header("authorization")
    const querySecret = c.req.query("key")
    const isAuthorized = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret
    if (!isAuthorized) return c.text("Unauthorized", 401)

    try {
        const result = await runDailyBriefing(bot)
        return c.json({ ok: true, ...result }, 200)
    } catch (error) {
        const details = error instanceof Error ? error.message : String(error)
        return c.json({ ok: false, error: details }, 500)
    }
})

app.get("/api/fitbit/connect", async (c) => {
    const telegramUserId = c.req.query("telegram_user_id")
    if (!telegramUserId) {
        return c.text("Missing telegram_user_id query parameter", 400)
    }

    const url = await createFitbitAuthorizationUrl(telegramUserId)
    return c.redirect(url)
})

app.get("/api/fitbit/callback", async (c) => {
    const error = c.req.query("error")
    if (error) {
        const errorDescription = c.req.query("error_description") ?? "unknown error"
        return c.text(`Fitbit OAuth error: ${error} (${errorDescription})`, 400)
    }

    const code = c.req.query("code")
    if (!code) {
        return c.text("Missing Fitbit OAuth code", 400)
    }

    const state = c.req.query("state")
    if (!state) {
        return c.text("Missing Fitbit OAuth state", 400)
    }

    try {
        await handleFitbitOAuthCallback(code, state)
        return c.text("OK", 200)
    } catch (err) {
        const details = err instanceof Error ? err.message : String(err)
        return c.text(`Fitbit callback failed: ${details}`, 500)
    }
})

app.post("/api/webhooks/telegram", async (c) => {
    const handler = bot.webhooks.telegram

    if (!handler) {
        return c.text("Telegram adapter not configured", 404)
    }

    const backgroundTasks: Promise<unknown>[] = []
    const response = await handler(c.req.raw, {
        waitUntil: (task) => {
            backgroundTasks.push(task)
        }
    })

    if (backgroundTasks.length > 0) {
        const results = await Promise.allSettled(backgroundTasks)
        for (const result of results) {
            if (result.status === "rejected") {
                console.error("WEBHOOK BACKGROUND TASK FAILED", result.reason)
            }
        }
    }

    return response
})


export default app
