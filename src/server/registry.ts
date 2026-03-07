import { commandModules } from "../commands/index.js"
import { type RawCommandContext as BaseCommandContext } from "../types/command.js"

export const COMMAND_ENTRIES = commandModules

export type CommandName = typeof COMMAND_ENTRIES[number]["command"]["name"]
export type CommandContext = BaseCommandContext<CommandName>
type Command = (typeof COMMAND_ENTRIES)[number]["command"]

type CommandMetadata = {
    description: string
    subcommands: readonly string[]
    actionIds: readonly string[]
}

const COMMANDS = new Map<CommandName, Command>(
    COMMAND_ENTRIES.map((entry) => [entry.command.name, entry.command] as const)
)

const COMMAND_ALIASES = new Map<string, CommandName>()
for (const entry of COMMAND_ENTRIES) {
    for (const alias of entry.aliases) {
        const normalizedAlias = alias.toLowerCase()
        if (COMMANDS.has(normalizedAlias as CommandName)) {
            throw new Error(`Alias '${normalizedAlias}' kollidiert mit einem Command-Namen.`)
        }
        if (COMMAND_ALIASES.has(normalizedAlias)) {
            throw new Error(`Alias '${normalizedAlias}' ist doppelt vergeben.`)
        }
        COMMAND_ALIASES.set(normalizedAlias, entry.command.name)
    }
}

export const COMMAND_METADATA = new Map<CommandName, CommandMetadata>(
    COMMAND_ENTRIES.map((entry) => [
        entry.command.name,
        {
            description: entry.description,
            subcommands: entry.subcommands,
            actionIds: entry.actionIds
        }
    ] as const)
)

export const isValidCommand = (value: string): value is CommandName =>
    COMMANDS.has(value as CommandName)

export const resolveCommandName = (value: string): CommandName | undefined => {
    const normalized = value.toLowerCase()
    if (isValidCommand(normalized)) return normalized
    return COMMAND_ALIASES.get(normalized)
}

export const getCommand = (name: CommandName): Command | undefined =>
    COMMANDS.get(name)

export const HELP_ACTION_IDS = COMMAND_ENTRIES.map((entry) => `help:${entry.command.name}`)

export const COMMAND_ACTION_IDS = COMMAND_ENTRIES.flatMap((entry) => entry.actionIds)
