import { Hono } from 'hono'
import { bot } from "./bot.js"

const app = new Hono()

app.get("/", (c) => c.text("Bot is running"))

app.post("/api/webhooks/telegram", async (c) => {
    const handler = bot.webhooks.telegram
    if (!handler) {
        return c.text("Telegram adapter not configured", 404)
    }
    // Process in-request to reduce concurrent handling of the same Telegram thread.
    return handler(c.req.raw)
})


export default app
