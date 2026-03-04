import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { postAgentReply } from "../agent/reply.js"
import { isAgentSessionActive } from "../agent/session.js"
import { isAuthorizedTelegramUser } from "../lib/auth.js"
import { rememberBriefingTarget } from "../lib/briefing.js"
import { trackMessage } from "../lib/messageHistory.js"
import { state } from "../types/state.js"
import {
    COMMAND_ACTION_IDS,
    COMMAND_METADATA,
    CommandContext,
    getCommand,
    HELP_ACTION_IDS,
    isValidCommand,
    resolveCommandName
} from "./registry.js"
import { parseActionToCommand } from "../lib/utils.js"
import { postThreadError } from "../errors/errorOutput.js"

export const bot = new Chat({
    userName: process.env.TELEGRAM_BOT_USERNAME!,
    state,
    adapters: {
        telegram: createTelegramAdapter()
    }
})

const agentActionIds = ["agent:choice"]
const actionIds = [...HELP_ACTION_IDS, ...COMMAND_ACTION_IDS, ...agentActionIds]

async function executeCommandWithValidation(ctx: CommandContext) {
    const commandDef = getCommand(ctx.command)
    if (!commandDef) return

    if (!commandDef.validateArgs(ctx.args)) {
        const subcommands = COMMAND_METADATA.get(ctx.command)?.subcommands ?? []
        const usageHint = subcommands.length > 0
            ? ` Erlaubt: ${subcommands.join(", ")}`
            : ""
        await ctx.thread.post(`Ungültige Argumente für /${ctx.command}.${usageHint}`)
        return
    }

    const parsed = commandDef.parseArgs(ctx.args)
    if (!parsed.ok) {
        const subcommands = COMMAND_METADATA.get(ctx.command)?.subcommands ?? []
        const usageHint = subcommands.length > 0
            ? ` Erlaubt: ${subcommands.join(", ")}`
            : ""
        await ctx.thread.post(`${parsed.message}.${usageHint}`)
        return
    }

    try {
        await commandDef.execute(ctx, parsed.value)
    } catch (error) {
        await postThreadError(ctx.thread, error, `/${ctx.command} fehlgeschlagen`)
    }
}

bot.onNewMention(async (thread) => {
    await thread.refresh()
    const latest = thread.recentMessages.find((msg) => !msg.author.isMe)
    if (!latest || !isAuthorizedTelegramUser(latest.author.userId)) return

    await thread.subscribe()
    await thread.post("Subscribed to thread for commands. Mention me with a command. /help for more info.")
})

bot.onAction(actionIds, async (event) => {
    if (!isAuthorizedTelegramUser(event.user.userId)) {
        await event.thread.post("Nicht autorisiert.")
        return
    }

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
        source: "action",
        actionMessageId: event.messageId,
        command,
        args
    }

    await rememberBriefingTarget(ctx.message.author.userId, ctx.thread.id)
    await executeCommandWithValidation(ctx)
})

bot.onSubscribedMessage(async (thread, message) => {
    await trackMessage(thread.id, message.id)

    if (message.author.isMe) return
    if (!isAuthorizedTelegramUser(message.author.userId)) {
        await thread.post("Nicht autorisiert.")
        return
    }

    const trimmedText = message.text.trim()
    if (!trimmedText) return

    const cmdToken = trimmedText.split(/\s+/)[0].toLowerCase()
    if (!cmdToken.startsWith("/")) {
        const agentSessionActive = await isAgentSessionActive(thread.id, message.author.userId)
        if (!agentSessionActive) return

        try {
            await rememberBriefingTarget(message.author.userId, thread.id)
            await postAgentReply(thread, trimmedText, message)
        } catch (error) {
            await postThreadError(thread, error, "Agent konnte nicht antworten")
        }
        return
    }

    const commandInput = cmdToken.replace(/^\/+/, "")
    const command = resolveCommandName(commandInput)
    if (!command) {
        await thread.post(`Unbekannter Befehl: ${commandInput}. /help für eine Liste der verfügbaren Befehle.`)
        return
    }

    const ctx: CommandContext = {
        thread,
        message,
        source: "message",
        command,
        args: trimmedText.split(/\s+/).slice(1)
    }

    await rememberBriefingTarget(ctx.message.author.userId, ctx.thread.id)
    await executeCommandWithValidation(ctx)
})
