import { Card, CardText } from "chat"
import { ButtonGrid } from "../components/buttonGrid.js"
import { Command, type CommandDefinition } from "../types/command.js"
import { capitalizeFirstLetter } from "../lib/utils.js"

const helpCommand: CommandDefinition<"help", {}> = {
    name: "help",
    argPolicy: { type: "none" },
    parseArgs: () => ({ ok: true, value: {} }),
    execute: async (ctx) => {
        const { COMMAND_ENTRIES, COMMAND_METADATA } = await import("../server/registry.js")
        const commandLines = COMMAND_ENTRIES.map(({ command }) => {
            const description = COMMAND_METADATA.get(command.name)?.description ?? "Keine Beschreibung."
            return `/${command.name}: ${description}`
        })

        await ctx.thread.post(
            Card({
                title: "📢 Verfügbare Befehle",
                children: [
                    ...ButtonGrid({
                        buttons: COMMAND_ENTRIES.map(({ command }) => ({
                            id: `help:${command.name}`,
                            label: capitalizeFirstLetter(command.name),
                            value: command.name
                        }))
                    }),
                    CardText(commandLines.join("\n")),
                ]
            })
        )
    }
}

export const help = new Command(helpCommand)
