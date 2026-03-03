import type { Hono } from "hono"
import { logError, toHttpError } from "../errors/errorOutput.js"

type OAuthRouteConfig = {
    providerName: string
    basePath: string
    createAuthorizationUrl: (telegramUserId: string) => Promise<string>
    handleOAuthCallback: (code: string, state: string) => Promise<unknown>
}

export function registerOAuthRoutes(app: Hono, config: OAuthRouteConfig) {
    const { providerName, basePath, createAuthorizationUrl, handleOAuthCallback } = config

    app.get(`/api/${basePath}/connect`, async (c) => {
        const userId = c.req.query("telegram_user_id")
        if (!userId) return c.text("Missing telegram_user_id query parameter", 400)

        try {
            const url = await createAuthorizationUrl(userId)
            return c.redirect(url)
        } catch (error) {
            logError(`${basePath}.connect`, error)
            const httpError = toHttpError(error)
            return c.json(httpError.body, httpError.status)
        }
    })

    app.get(`/api/${basePath}/callback`, async (c) => {
        const error = c.req.query("error")
        if (error) {
            const errorDescription = c.req.query("error_description") ?? "unknown error"
            return c.text(`${providerName} OAuth error: ${error} (${errorDescription})`, 400)
        }

        const code = c.req.query("code")
        if (!code) return c.text(`Missing ${providerName} OAuth code`, 400)

        const state = c.req.query("state")
        if (!state) return c.text(`Missing ${providerName} OAuth state`, 400)

        try {
            await handleOAuthCallback(code, state)
            return c.text("OK", 200)
        } catch (error) {
            logError(`${basePath}.callback`, error)
            const httpError = toHttpError(error)
            return c.json(httpError.body, httpError.status)
        }
    })
}
