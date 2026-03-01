import type { Hono } from "hono"
import { createGoogleAuthorizationUrl, handleGoogleOAuthCallback } from "../lib/googleCalendar.js"

export function registerGoogleRoutes(app: Hono) {
    app.get("/api/google/connect", async (c) => {
        const userId = c.req.query("telegram_user_id")
        if (!userId) return c.text("Missing telegram_user_id query parameter", 400)

        const url = await createGoogleAuthorizationUrl(userId)
        return c.redirect(url)
    })

    app.get("/api/google/callback", async (c) => {
        const error = c.req.query("error")
        if (error) {
            const errorDescription = c.req.query("error_description") ?? "unknown error"
            return c.text(`Google OAuth error: ${error} (${errorDescription})`, 400)
        }

        const code = c.req.query("code")
        if (!code) return c.text("Missing Google OAuth code", 400)

        const state = c.req.query("state")
        if (!state) return c.text("Missing Google OAuth state", 400)

        try {
            await handleGoogleOAuthCallback(code, state)
            return c.text("OK", 200)
        } catch (err) {
            const details = err instanceof Error ? err.message : String(err)
            return c.text(`Google callback failed: ${details}`, 500)
        }
    })
}
