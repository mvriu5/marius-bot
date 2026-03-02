import { analytics } from "../commands/analyticsCommand.js"
import { account } from "../commands/accountCommand.js"
import { agent } from "../commands/agentCommand.js"
import { clear } from "../commands/clearCommand.js"
import { fitbit } from "../commands/fitbitCommand.js"
import { github } from "../commands/githubCommand.js"
import { help } from "../commands/helpCommand.js"
import { meetings } from "../commands/meetingCommand.js"
import { news } from "../commands/newsCommand.js"
import { weather } from "../commands/weatherCommand.js"
import { type CommandContext as BaseCommandContext } from "../types/command.js"

const commands = [help, clear, fitbit, weather, news, meetings, account, github, analytics, agent] as const

export type CommandName = typeof commands[number]["name"]
export type CommandContext = BaseCommandContext<CommandName>
type Command = (typeof commands)[number]

export const COMMANDS = new Map<CommandName, Command>(
    commands.map((command) => [command.name, command] as const)
)

export const isValidCommand = (value: string): value is CommandName =>
    COMMANDS.has(value as CommandName)

export const getCommand = (name: CommandName): Command | undefined =>
    COMMANDS.get(name)
