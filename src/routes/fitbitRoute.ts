import type { Hono } from "hono"
import { createFitbitAuthorizationUrl, handleFitbitOAuthCallback } from "../lib/fitbit.js"
import { registerOAuthRoutes } from "./oauthRoute.js"

export function registerFitbitRoutes(app: Hono) {
    registerOAuthRoutes(app, {
        providerName: "Fitbit",
        basePath: "fitbit",
        createAuthorizationUrl: createFitbitAuthorizationUrl,
        handleOAuthCallback: handleFitbitOAuthCallback
    })
}
