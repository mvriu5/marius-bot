import { Hono } from "hono"
import { registerJobRoutes } from "./routes/jobsRoute.js"
import { registerOAuthRoutes } from "./routes/oauthRoute.js"
import { registerQstashRoutes } from "./routes/qstashRoute.js"
import { registerRootRoute } from "./routes/rootRoute.js"
import { registerTelegramRoutes } from "./routes/telegramRoute.js"
import { createFitbitAuthorizationUrl, handleFitbitOAuthCallback } from "./lib/fitbit.js"
import { createGoogleAuthorizationUrl, handleGoogleOAuthCallback } from "./lib/googleCalendar.js"
import { createGithubAuthorizationUrl, handleGithubOAuthCallback } from "./lib/github.js"
import { createNotionAuthorizationUrl, handleNotionOAuthCallback } from "./lib/notion.js"
import { createNotionMcpAuthorizationUrl, handleNotionMcpOAuthCallback } from "./lib/notionMcp.js"

const app = new Hono()

registerRootRoute(app)
registerJobRoutes(app)
registerTelegramRoutes(app)
registerQstashRoutes(app)

registerOAuthRoutes(app, {
    providerName: "Fitbit",
    basePath: "fitbit",
    createAuthorizationUrl: createFitbitAuthorizationUrl,
    handleOAuthCallback: handleFitbitOAuthCallback
})
registerOAuthRoutes(app, {
    providerName: "Google",
    basePath: "google",
    createAuthorizationUrl: createGoogleAuthorizationUrl,
    handleOAuthCallback: handleGoogleOAuthCallback
})
registerOAuthRoutes(app, {
    providerName: "GitHub",
    basePath: "github",
    createAuthorizationUrl: createGithubAuthorizationUrl,
    handleOAuthCallback: handleGithubOAuthCallback
})
registerOAuthRoutes(app, {
    providerName: "Notion",
    basePath: "notion",
    createAuthorizationUrl: createNotionAuthorizationUrl,
    handleOAuthCallback: handleNotionOAuthCallback
})
registerOAuthRoutes(app, {
    providerName: "Notion MCP",
    basePath: "notion-mcp",
    createAuthorizationUrl: createNotionMcpAuthorizationUrl,
    handleOAuthCallback: handleNotionMcpOAuthCallback
})

export default app
