import { account } from "../commands/accountCommand.js"
import { fitbit } from "../commands/fitbitCommand.js"
import { help } from "../commands/helpCommand.js"
import { meetings } from "../commands/meetingCommand.js"
import { news } from "../commands/newsCommand.js"
import { weather } from "../commands/weatherCommand.js"
import { type CommandContext as BaseCommandContext } from "../types/command.js"

export const commands = [help, fitbit, weather, news, meetings, account] as const

export type CommandName = typeof commands[number]["name"]
export type CommandContext = BaseCommandContext<CommandName>
export type Command = (typeof commands)[number]

export const COMMANDS = new Map<CommandName, Command>(
    commands.map((command) => [command.name, command] as const)
)

export const isValidCommand = (value: string): value is CommandName =>
    COMMANDS.has(value as CommandName)

export const getCommand = (name: CommandName): Command | undefined =>
    COMMANDS.get(name)
