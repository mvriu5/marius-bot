import { Hono } from 'hono'
import { bot } from "./bot"

const app = new Hono()

app.post("/api/webhooks/telegram", async (c) => {
    const handler = bot.webhooks.telegram
    if (!handler) {
        return c.text("GitHub adapter not configured", 404);
    }
    return handler(c.req.raw, {
        waitUntil: (task: any) => c.executionCtx.waitUntil(task)
    })
})


export default app
