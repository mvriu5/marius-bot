import type { Hono } from "hono"
import { createGoogleAuthorizationUrl, handleGoogleOAuthCallback } from "../lib/googleCalendar.js"
import { registerOAuthRoutes } from "./oauthRoute.js"

export function registerGoogleRoutes(app: Hono) {
    registerOAuthRoutes(app, {
        providerName: "Google",
        basePath: "google",
        createAuthorizationUrl: createGoogleAuthorizationUrl,
        handleOAuthCallback: handleGoogleOAuthCallback
    })
}
