import { createCommand, type CommandDefinition } from "../../types/command.js"
import { ACTION_IDS } from "../shared/actionIds.js"
import { defineCommandModule } from "../shared/module.js"
import { parseCopilotArgs } from "./parse.js"
import { executeCopilot } from "./service.js"
import { type CopilotParsedArgs } from "./types.js"

const copilotCommand: CommandDefinition<"copilot", CopilotParsedArgs> = {
    name: "copilot",
    argPolicy: { type: "any" },
    parseArgs: parseCopilotArgs,
    execute: executeCopilot
}

export const copilot = createCommand(copilotCommand)

export const copilotModule = defineCommandModule({
    command: copilot,
    description: "Startet Copilot-Tasks und behandelt PR-Entscheidungen.",
    aliases: ["cp"] as const,
    subcommands: ["<text>", "repo <pendingId> <owner/repo>", "merge <taskId>", "reject <taskId>", "later <taskId>"] as const,
    actionIds: [ACTION_IDS.copilot.repo, ACTION_IDS.copilot.merge, ACTION_IDS.copilot.reject, ACTION_IDS.copilot.later] as const
})
