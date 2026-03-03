import type { Hono } from "hono"
import { createGithubAuthorizationUrl, handleGithubOAuthCallback } from "../lib/github.js"
import { registerOAuthRoutes } from "./oauthRoute.js"

export function registerGithubRoutes(app: Hono) {
    registerOAuthRoutes(app, {
        providerName: "GitHub",
        basePath: "github",
        createAuthorizationUrl: createGithubAuthorizationUrl,
        handleOAuthCallback: handleGithubOAuthCallback
    })
}
