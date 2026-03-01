import type { Hono } from "hono"

export function registerRootRoute(app: Hono) {
    app.get("/", (c) => c.text("Bot is running"))
}
