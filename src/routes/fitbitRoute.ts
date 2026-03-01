import type { Hono } from "hono"
import { createFitbitAuthorizationUrl, handleFitbitOAuthCallback } from "../lib/fitbit.js"

export function registerFitbitRoutes(app: Hono) {
    app.get("/api/fitbit/connect", async (c) => {
        const userId = c.req.query("telegram_user_id")
        if (!userId) return c.text("Missing telegram_user_id query parameter", 400)

        const url = await createFitbitAuthorizationUrl(userId)
        return c.redirect(url)
    })

    app.get("/api/fitbit/callback", async (c) => {
        const error = c.req.query("error")
        if (error) {
            const errorDescription = c.req.query("error_description") ?? "unknown error"
            return c.text(`Fitbit OAuth error: ${error} (${errorDescription})`, 400)
        }

        const code = c.req.query("code")
        if (!code) return c.text("Missing Fitbit OAuth code", 400)

        const state = c.req.query("state")
        if (!state) return c.text("Missing Fitbit OAuth state", 400)

        try {
            await handleFitbitOAuthCallback(code, state)
            return c.text("OK", 200)
        } catch (err) {
            const details = err instanceof Error ? err.message : String(err)
            return c.text(`Fitbit callback failed: ${details}`, 500)
        }
    })
}
