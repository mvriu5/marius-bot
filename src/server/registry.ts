import { analytics } from "../commands/analyticsCommand.js"
import { account } from "../commands/accountCommand.js"
import { agent } from "../commands/agentCommand.js"
import { clear } from "../commands/clearCommand.js"
import { copilot } from "../commands/copilotCommand.js"
import { fitbit } from "../commands/fitbitCommand.js"
import { github } from "../commands/githubCommand.js"
import { help } from "../commands/helpCommand.js"
import { meetings } from "../commands/meetingCommand.js"
import { news } from "../commands/newsCommand.js"
import { notion } from "../commands/notionCommand.js"
import { remind } from "../commands/remindCommand.js"
import { weather } from "../commands/weatherCommand.js"
import { type RawCommandContext as BaseCommandContext } from "../types/command.js"

export const COMMAND_ENTRIES = [
    {
        command: help,
        description: "Zeigt alle verfügbaren Befehle.",
        aliases: ["h"] as const,
        subcommands: [] as const,
        actionIds: [] as const
    },
    {
        command: clear,
        description: "Loescht Bot-Nachrichten im aktuellen Thread.",
        aliases: ["c"] as const,
        subcommands: [] as const,
        actionIds: [] as const
    },
    {
        command: copilot,
        description: "Startet Copilot-Tasks und behandelt PR-Entscheidungen.",
        aliases: ["cp"] as const,
        subcommands: ["<text>", "repo <pendingId> <owner/repo>", "merge <taskId>", "reject <taskId>", "later <taskId>"] as const,
        actionIds: ["c:copilot:repo", "c:copilot:merge", "c:copilot:reject", "c:copilot:later"] as const
    },
    {
        command: fitbit,
        description: "Zeigt Fitbit-Daten und Login-Optionen.",
        aliases: ["fb"] as const,
        subcommands: ["login", "summary", "activity", "week"] as const,
        actionIds: ["command:fitbit:login", "command:fitbit:summary", "command:fitbit:activity", "command:fitbit:week"] as const
    },
    {
        command: weather,
        description: "Zeigt das Wetter oder speichert eine Standard-Location.",
        aliases: ["wetter"] as const,
        subcommands: ["set <location>", "tomorrow [location]"] as const,
        actionIds: [] as const
    },
    {
        command: news,
        description: "Liest die aktuellen News-Feeds.",
        aliases: [] as const,
        subcommands: [] as const,
        actionIds: [] as const
    },
    {
        command: remind,
        description: "Setzt eine Erinnerung zu einer Uhrzeit.",
        aliases: ["rm"] as const,
        subcommands: ["<duration|time|datetime> <text>"] as const,
        actionIds: [] as const
    },
    {
        command: meetings,
        description: "Zeigt heutige Kalender-Meetings.",
        aliases: ["meeting", "calendar", "schedule"] as const,
        subcommands: ["login", "summary"] as const,
        actionIds: ["command:meetings:login", "command:meetings:summary"] as const
    },
    {
        command: account,
        description: "Zeigt den Verbindungsstatus aller Integrationen.",
        aliases: ["acc"] as const,
        subcommands: [] as const,
        actionIds: [] as const
    },
    {
        command: github,
        description: "Zeigt GitHub Commits, Issues und PRs.",
        aliases: ["gh", "git"] as const,
        subcommands: ["login", "commits", "issues", "prs"] as const,
        actionIds: [
            "command:github:login",
            "command:github:commits",
            "command:github:issues",
            "command:github:prs"
        ] as const
    },
    {
        command: notion,
        description: "Verwaltet Notion-Integration (Login, Seitenauflistung).",
        aliases: [] as const,
        subcommands: ["login", "pages"] as const,
        actionIds: ["command:notion:login", "command:notion:pages"] as const
    },
    {
        command: analytics,
        description: "Zeigt Website-Analytics der letzten 24 Stunden.",
        aliases: [] as const,
        subcommands: ["<site (optional)>"] as const,
        actionIds: [] as const
    },
    {
        command: agent,
        description: "Aktiviert den Agent-Modus oder beantwortet eine Frage.",
        aliases: ["ai", "gpt", "ask"] as const,
        subcommands: ["<frage>"] as const,
        actionIds: [] as const
    },
] as const

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
