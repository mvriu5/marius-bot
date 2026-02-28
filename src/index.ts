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

    return handler(c.req.raw, {
        waitUntil: (task) => c.executionCtx.waitUntil(task)
    })
})


export default app
