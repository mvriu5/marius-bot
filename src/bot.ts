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
    await thread.post(`You said: ${message.text}`)
})

bot.onNewMessage(/^!help/i, async (thread, message) => {
    await thread.post("Available commands: !help, !status")
})
