import { Hono } from 'hono'
import { bot } from "./bot.js"
import { waitUntil } from '@vercel/functions'

const app = new Hono()

app.get("/", (c) => c.text("Bot is running"))

app.post("/api/webhooks/telegram", async (c) => {
    console.log("WEBHOOK HIT");

    return bot.webhooks.telegram(c.req.raw, {
        waitUntil: (task) =>
            waitUntil(
                task.catch((err) => {
                    console.error("BACKGROUND ERROR", err);
                })
            )
    })
})


export default app
