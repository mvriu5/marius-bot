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

    if (backgroundTasks.length > 0) {
        await Promise.allSettled(backgroundTasks)
    }

    return response
})


export default app
