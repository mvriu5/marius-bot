import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { rememberBriefingTarget } from "../lib/briefing.js"
import { state } from "../types/state.js"
import { CommandContext, getCommand, isValidCommand } from "./registry.js"

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

bot.onSubscribedMessage(async (thread, message) => {
    const cmdToken = message.text.trim().split(/\s+/)[0].toLowerCase()
    if (!cmdToken.startsWith("/")) return

    const command = cmdToken.replace(/^\/+/, "")
    if (!isValidCommand(command)) {
        await thread.post(`Unbekannter Befehl: ${command}. /help für eine Liste der verfügbaren Befehle.`)
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
