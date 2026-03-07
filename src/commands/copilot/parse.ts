import { type CommandParseResult } from "../../types/command.js"
import { type CopilotParsedArgs } from "./types.js"

export function parseCopilotArgs(args: readonly string[]): CommandParseResult<CopilotParsedArgs> {
    if (args.length === 0) {
        return { ok: false, message: "Bitte nutze /copilot <text>" }
    }

    const action = args[0]?.toLowerCase()
    if (action === "login") return { ok: true, value: { action: "login" } }

    if (action === "repo") {
        const selectionId = args[1]
        if (!selectionId) {
            return { ok: false, message: "Nutze /copilot repo <selectionId>" }
        }
        return { ok: true, value: { action: "repo", selectionId } }
    }

    if (action === "merge" || action === "reject" || action === "later") {
        const taskId = args[1]
        if (!taskId) {
            return { ok: false, message: `Nutze /copilot ${action} <taskId>` }
        }
        return { ok: true, value: { action, taskId } }
    }

    return {
        ok: true,
        value: {
            action: "start",
            prompt: args.join(" ").trim()
        }
    }
}
