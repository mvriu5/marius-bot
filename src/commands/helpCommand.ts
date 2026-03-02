import { Actions, Button, Card, CardText } from "chat"
import { COMMANDS } from "../server/registry.js"
import { Command, type CommandDefinition } from "../types/command.js"

const COMMAND_SUBCOMMANDS: Partial<Record<string, readonly string[]>> = {
    fitbit: ["login", "summary"],
    meetings: ["login", "summary"]
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
                title: "Verfügbare Befehle",
                children: [
                    CardText("Wähle einen Befehl:"),
                    Actions(
                        Array.from(COMMANDS.values()).map((cmd) =>
                            Button({
                                id: `help:${cmd.name}`,
                                label: `/${cmd.name}`,
                                value: cmd.name
                            })
                        )
                    ),
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
