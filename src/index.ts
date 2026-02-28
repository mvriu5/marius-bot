import { Hono } from 'hono'
import { bot } from "./bot.js"

const app = new Hono()

app.get("/", (c) => c.text("Bot is running"))

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
