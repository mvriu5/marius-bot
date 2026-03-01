import { COMMANDS } from "../server/registry.js"
import { Command, type CommandDefinition } from "../types/command.js"

const helpCommand: CommandDefinition<"help"> = {
    name: "help",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        await ctx.thread.post(
            `Verfügbare Befehle:\n` +
            Array.from(COMMANDS.values()).map((cmd) => `/${cmd.name}`).join("\n")
        )
    }
}

export const help = new Command(helpCommand)
