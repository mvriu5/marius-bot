import { Card, CardText } from "chat"
import { ButtonGrid } from "../components/buttonGrid.js"
import { COMMAND_ENTRIES, COMMAND_METADATA } from "../server/registry.js"
import { Command, type CommandDefinition } from "../types/command.js"
import { capitalizeFirstLetter } from "../lib/utils.js"

const helpCommand: CommandDefinition<"help"> = {
    name: "help",
    argPolicy: { type: "none" },
    execute: async (ctx) => {
        const commandLines = COMMAND_ENTRIES.map(({ command }) => {
            const description = COMMAND_METADATA.get(command.name)?.description ?? "Keine Beschreibung."
            return `/${command.name}: ${description}`
        })

        const subcommandLines = COMMAND_ENTRIES
            .map(({ command }) => {
                const subcommands = COMMAND_METADATA.get(command.name)?.subcommands ?? []
                if (!subcommands || subcommands.length === 0) return null
                return `/${command.name}: ${subcommands.join(", ")}`
            })
            .filter((line): line is string => Boolean(line))

        await ctx.thread.post(
            Card({
                title: "📢 Verfügbare Befehle",
                children: [
                    CardText("Wähle einen Befehl:"),
                    ...ButtonGrid({
                        buttons: COMMAND_ENTRIES.map(({ command }) => ({
                            id: `help:${command.name}`,
                            label: capitalizeFirstLetter(command.name),
                            value: command.name
                        }))
                    }),
                    CardText("Befehlsübersicht:"),
                    CardText(commandLines.join("\n")),
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
