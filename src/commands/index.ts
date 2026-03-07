import { accountModule } from "./accountCommand.js"
import { agentModule } from "./agentCommand.js"
import { analyticsModule } from "./analyticsCommand.js"
import { clearModule } from "./clearCommand.js"
import { copilotModule } from "./copilotCommand.js"
import { eventModule } from "./eventCommand.js"
import { fitbitModule } from "./fitbitCommand.js"
import { githubModule } from "./githubCommand.js"
import { helpModule } from "./helpCommand.js"
import { meetingsModule } from "./meetingCommand.js"
import { newsModule } from "./newsCommand.js"
import { notionModule } from "./notionCommand.js"
import { remindModule } from "./remindCommand.js"
import { weatherModule } from "./weatherCommand.js"

export const commandModules = [
    helpModule,
    clearModule,
    copilotModule,
    fitbitModule,
    weatherModule,
    newsModule,
    remindModule,
    meetingsModule,
    eventModule,
    accountModule,
    githubModule,
    notionModule,
    analyticsModule,
    agentModule
] as const
