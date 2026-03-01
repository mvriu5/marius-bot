import type { Hono } from "hono"
import { bot } from "../server/bot.js"

export function registerTelegramRoutes(app: Hono) {
    app.post("/api/webhooks/telegram", async (c) => {
        const handler = bot.webhooks.telegram
        if (!handler) return c.text("Telegram adapter not configured", 404)

        const backgroundTasks: Promise<unknown>[] = []
        const response = await handler(c.req.raw, {
            waitUntil: (task) => { backgroundTasks.push(task) }
        })

        if (backgroundTasks.length > 0) {
            const results = await Promise.allSettled(backgroundTasks)
            for (const result of results) {
                if (result.status !== "rejected") continue
                console.error("WEBHOOK BACKGROUND TASK FAILED", result.reason)
            }
        }

        return response
    })
}
