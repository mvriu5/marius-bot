import { Hono } from "hono"
import { registerFitbitRoutes } from "./routes/fitbitRoute.js"
import { registerJobRoutes } from "./routes/jobsRoute.js"
import { registerRootRoute } from "./routes/rootRoute.js"
import { registerTelegramRoutes } from "./routes/telegramRoute.js"

const app = new Hono()

registerRootRoute(app)
registerJobRoutes(app)
registerFitbitRoutes(app)
registerTelegramRoutes(app)

export default app
