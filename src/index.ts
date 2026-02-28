import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { bot } from "./bot.js"

export const config = { runtime: 'edge' }

const app = new Hono()

app.get("/", (c) => c.text("Bot is running"))

app.post("/api/webhooks/telegram", async (c) => {
    const handler = bot.webhooks.telegram
    if (!handler) {
        return c.text("Telegram adapter not configured", 404)
    }
    return handler(c.req.raw, {
        waitUntil: (task) => c.executionCtx.waitUntil(task)
    })
})


export default handle(app)
