import { Chat } from "chat"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import { createRedisState } from "@chat-adapter/state-redis"

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME
const redisUrl = process.env.REDIS_URL

if (!telegramBotToken) throw new Error("Missing TELEGRAM_BOT_TOKEN")
if (!telegramBotUsername) throw new Error("Missing TELEGRAM_BOT_USERNAME")
if (!redisUrl) throw new Error("Missing REDIS_URL")

export const bot = new Chat({
    logger: "info",
    userName: telegramBotUsername,
    state: createRedisState({ url: redisUrl }),
    adapters: {
        telegram: createTelegramAdapter({
            botToken: telegramBotToken,
            apiBaseUrl: process.env.TELEGRAM_API_BASE_URL,
            secretToken: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
            userName: telegramBotUsername
        })
    }
})

bot.onNewMention(async (thread, message) => {
    console.log("onNewMention fired", { text: message.text, threadId: thread.id })
    await thread.post(`You said: ${message.text}`)
    console.log("onNewMention post sent", { threadId: thread.id })
})

bot.onSubscribedMessage(async (thread, message) => {
    console.log("onSubscribedMessage fired", { text: message.text, threadId: thread.id })
    await thread.post(`SUB: You said: ${message.text}`)
    console.log("onSubscribedMessage post sent", { threadId: thread.id })
})

bot.onSlashCommand("/fitbit", async (event) => {
    console.log("onSlashCommand fired", { command: event.command, threadId: event.channel.id })
    await event.channel.post(`You invoked the /fitbit command with args:`)
    console.log("onSlashCommand post sent", { threadId: event.channel.id })
})
