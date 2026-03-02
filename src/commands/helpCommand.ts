import { Card, CardText } from "chat"
import { ButtonGrid } from "../components/buttonGrid.js"
import { COMMANDS } from "../server/registry.js"
import { Command, type CommandDefinition } from "../types/command.js"
import { capitalizeFirstLetter } from "../lib/utils.js"

const COMMAND_SUBCOMMANDS: Partial<Record<string, readonly string[]>> = {
    agent: ["<frage>"],
    analytics: ["<site (optional)>"],
    fitbit: ["login", "summary"],
    github: ["login", "commits", "issues", "prs"],
    meetings: ["login", "summary"],
    weather: ["set <location>"]
}

const helpCommand: CommandDefinition<"help"> = {
    name: "help",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        const subcommandLines = Array.from(COMMANDS.values())
            .map((cmd) => {
                const subcommands = COMMAND_SUBCOMMANDS[cmd.name]
                if (!subcommands || subcommands.length === 0) return null
                return `/${cmd.name}: ${subcommands.join(", ")}`
            })
            .filter((line): line is string => Boolean(line))

        await ctx.thread.post(
            Card({
                title: "📢 Verfügbare Befehle",
                children: [
                    CardText("Wähle einen Befehl:"),
                    ...ButtonGrid({
                        buttons: Array.from(COMMANDS.values()).map((cmd) => ({
                            id: `help:${cmd.name}`,
                            label: capitalizeFirstLetter(cmd.name),
                            value: cmd.name
                        }))
                    }),
                    ...(subcommandLines.length > 0
                        ? [
                            CardText("Erlaubte Subcommands:"),
                            CardText(subcommandLines.join("\n"))
                        ]
                        : [])
                ]
            })
        )
    }
}

export const help = new Command(helpCommand)
