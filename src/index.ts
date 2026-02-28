import { Hono } from 'hono'
import { bot } from "./bot.js"

const app = new Hono()

app.get("/", (c) => c.text("Bot is running"))

app.post("/api/webhooks/telegram", async (c) => {
    try {
        const handler = bot.webhooks.telegram
        if (!handler) {
            return c.text("Telegram adapter not configured", 404)
        }
        return await handler(c.req.raw, {
            waitUntil: (task: Promise<unknown>) => {
                task.catch((err) => console.error("[telegram] background task error", err));
            },
        });
    } catch (error) {
        console.error("[telegram-webhook] handler error", error)
        return c.text("OK", 200)
    }
})


export default app
