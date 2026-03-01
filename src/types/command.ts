import { fitbit } from "../commands/fitbitCommand.js"
import { help } from "../commands/helpCommand.js"
import { news } from "../commands/newsCommand.js"
import { weather } from "../commands/weatherCommand.js"
import { type CommandContext as BaseCommandContext } from "./command-base.js"

export const commands = [help, fitbit, weather, news] as const

export type CommandName = typeof commands[number]["name"]
export type CommandContext = BaseCommandContext<CommandName>
export type Command = (typeof commands)[number]

export const COMMAND_NAMES = commands.map((command) => command.name) as CommandName[]

const commandNameSet = new Set<string>(COMMAND_NAMES)

export const isCommandName = (value: string): value is CommandName =>
    commandNameSet.has(value)

export const getCommand = (name: CommandName): Command | undefined =>
    commands.find((command) => command.name === name)
