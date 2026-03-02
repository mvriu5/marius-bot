import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { postAgentReply } from "../agent/reply.js"
import { isAgentSessionActive } from "../agent/session.js"
import { rememberBriefingTarget } from "../lib/briefing.js"
import { trackMessage } from "../lib/messageHistory.js"
import { state } from "../types/state.js"
import { COMMANDS, CommandContext, getCommand, isValidCommand } from "./registry.js"
import { parseActionToCommand } from "../lib/utils.js"

export const bot = new Chat({
    userName: process.env.TELEGRAM_BOT_USERNAME!,
    state,
    adapters: {
        telegram: createTelegramAdapter()
    }
})

const helpActionIds = Array.from(COMMANDS.values()).map((cmd) => `help:${cmd.name}`)
const meetingActionIds = ["command:meetings:login", "command:meetings:summary"]
const fitbitActionIds = ["command:fitbit:login", "command:fitbit:summary"]
const githubActionIds = ["command:github:login", "command:github:commits", "command:github:issues", "command:github:prs"]
const agentActionIds = ["agent:choice"]
const actionIds = [...helpActionIds, ...meetingActionIds, ...fitbitActionIds, ...githubActionIds, ...agentActionIds]

bot.onNewMention(async (thread) => {
    await thread.subscribe()
    await thread.post("Subscribed to thread for commands. Mention me with a command. /help for more info.")
})

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
    await trackMessage(thread.id, message.id)

    if (message.author.isMe) return

    const trimmedText = message.text.trim()
    if (!trimmedText) return

    const cmdToken = trimmedText.split(/\s+/)[0].toLowerCase()
    if (!cmdToken.startsWith("/")) {
        const agentSessionActive = await isAgentSessionActive(thread.id, message.author.userId)
        if (!agentSessionActive) return

        await rememberBriefingTarget(message.author.userId, thread.id)
        await postAgentReply(thread, trimmedText)
        return
    }

    const command = cmdToken.replace(/^\/+/, "")
    if (!isValidCommand(command)) {
        await thread.post(`Unbekannter Befehl: ${command}. /help fuer eine Liste der verfuegbaren Befehle.`)
        return
    }

    const ctx: CommandContext = {
        thread,
        message,
        command,
        args: trimmedText.split(/\s+/).slice(1)
    }

    await rememberBriefingTarget(ctx.message.author.userId, ctx.thread.id)
    await getCommand(ctx.command)?.execute(ctx)
})
