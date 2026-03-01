import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { COMMAND_NAMES, CommandContext, getCommand, isCommandName } from "../types/command.js"
import { state } from "../types/state.js"
import { rememberBriefingTarget } from "../lib/briefing.js"

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME
if (!telegramBotToken) throw new Error("Missing TELEGRAM_BOT_TOKEN")
if (!telegramBotUsername) throw new Error("Missing TELEGRAM_BOT_USERNAME")

export const bot = new Chat({
    logger: "info",
    userName: telegramBotUsername,
    state,
    adapters: {
        telegram: createTelegramAdapter({
            botToken: telegramBotToken,
            apiBaseUrl: process.env.TELEGRAM_API_BASE_URL,
            secretToken: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
            userName: telegramBotUsername
        })
    }
})

bot.onNewMention(async (thread) => {
    await thread.subscribe()
    await thread.post("Subscribed to thread for commands. Mention me with a command. /help for more info.")
})

bot.onSubscribedMessage(async (thread, message) => {
    const commandToken = message.text.trim().split(/\s+/)[0].toLowerCase()
    if (!commandToken.startsWith("/")) return

    const command = commandToken.replace(/^\/+/, "")
    if (!isCommandName(command)) {
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
