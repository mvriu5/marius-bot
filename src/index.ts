import { Hono } from 'hono'
import { bot } from "./bot.js"
import { createFitbitAuthorizationUrl, handleFitbitOAuthCallback } from "./fitbit.js"

const app = new Hono()

app.get("/", (c) => c.text("Bot is running"))

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
        const result = await handleFitbitOAuthCallback(code, state)
        return c.text(
            `Fitbit verbunden fuer Telegram User ${result.telegramUserId}. Du kannst jetzt im Chat /fitbit senden.`,
            200
        )
    } catch (err) {
        const details = err instanceof Error ? err.message : String(err)
        return c.text(`Fitbit callback failed: ${details}`, 500)
    }
})

app.post("/api/webhooks/telegram", async (c) => {
    console.log("WEBHOOK HIT")
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
    console.log("WEBHOOK HANDLER STATUS", response.status)

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
