import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { rememberBriefingTarget } from "../lib/briefing.js"
import { state } from "../types/state.js"
import { COMMANDS, CommandContext, getCommand, isValidCommand } from "./registry.js"

export const bot = new Chat({
    userName: process.env.TELEGRAM_BOT_USERNAME!,
    state,
    adapters: {
        telegram: createTelegramAdapter()
    }
})

bot.onNewMention(async (thread) => {
    await thread.subscribe()
    await thread.post("Subscribed to thread for commands. Mention me with a command. /help for more info.")
})

const helpActionIds = Array.from(COMMANDS.values()).map((cmd) => `help:${cmd.name}`)
const meetingActionIds = ["command:meetings:login", "command:meetings:summary"]
const fitbitActionIds = ["command:fitbit:login", "command:fitbit:summary"]
const githubActionIds = ["command:github:login", "command:github:commits", "command:github:issues", "command:github:prs"]

const actionIds = [...helpActionIds, ...meetingActionIds, ...fitbitActionIds, ...githubActionIds]

function parseActionToCommand(actionId: string, value?: string): { command: string; args: string[] } {
    const valueParts = (value ?? "").trim().split(/\s+/).filter(Boolean)
    if (valueParts.length > 0) {
        const [command, ...args] = valueParts
        return { command: command.toLowerCase(), args: args.map((arg) => arg.toLowerCase()) }
    }

    if (actionId.startsWith("help:")) {
        return { command: actionId.replace(/^help:/, "").toLowerCase(), args: [] }
    }

    if (actionId.startsWith("command:")) {
        const [, command = "", ...args] = actionId.split(":")
        return { command: command.toLowerCase(), args: args.map((arg) => arg.toLowerCase()) }
    }

    return { command: "", args: [] }
}

bot.onAction(actionIds, async (event) => {
    const { command, args } = parseActionToCommand(event.actionId, event.value)
    if (!isValidCommand(command)) {
        await event.thread.post(`Unbekannter Befehl: ${command}. /help für eine Liste der verfügbaren Befehle.`)
        return
    }

    const syntheticText = `/${[command, ...args].join(" ")}`
    const ctx: CommandContext = {
        thread: event.thread as CommandContext["thread"],
        message: {
            author: event.user,
            text: syntheticText
        } as CommandContext["message"],
        command,
        args
    }

    await rememberBriefingTarget(ctx.message.author.userId, ctx.thread.id)
    await getCommand(ctx.command)?.execute(ctx)
})

bot.onSubscribedMessage(async (thread, message) => {
    const cmdToken = message.text.trim().split(/\s+/)[0].toLowerCase()
    if (!cmdToken.startsWith("/")) return

    const command = cmdToken.replace(/^\/+/, "")
    if (!isValidCommand(command)) {
        await thread.post(`Unbekannter Befehl: ${command}. /help fuer eine Liste der verfuegbaren Befehle.`)
        return
    }

    const ctx: CommandContext = {
        thread,
        message,
        command,
        args: message.text.trim().split(/\s+/).slice(1)
    }

    await rememberBriefingTarget(ctx.message.author.userId, ctx.thread.id)
    await getCommand(ctx.command)?.execute(ctx)
})
