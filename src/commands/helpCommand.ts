import { Command, type CommandInit } from "../types/command-base.js"
import { COMMAND_NAMES } from "../types/command.js"

const helpCommand: CommandInit<"help"> = {
    name: "help",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        await ctx.thread.post(
            `Verfügbare Befehle:\n` +
            COMMAND_NAMES.map((cmd) => `/${cmd}`).join("\n")
        )
    }
}

export const help = new Command(helpCommand)
