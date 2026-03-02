import { Hono } from "hono"
import { registerFitbitRoutes } from "./routes/fitbitRoute.js"
import { registerGoogleRoutes } from "./routes/googleRoute.js"
import { registerJobRoutes } from "./routes/jobsRoute.js"
import { registerRootRoute } from "./routes/rootRoute.js"
import { registerTelegramRoutes } from "./routes/telegramRoute.js"
import { registerGithubRoutes } from "./routes/githubRoute.js"

const app = new Hono()

registerRootRoute(app)
registerJobRoutes(app)
registerFitbitRoutes(app)
registerGoogleRoutes(app)
registerGithubRoutes(app)
registerTelegramRoutes(app)

export default app
