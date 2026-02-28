import { Chat } from "chat"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import { createRedisState } from "@chat-adapter/state-redis"

export const bot = new Chat({
    userName: process.env.TELEGRAM_BOT_USERNAME!,
    state: createRedisState({ url: process.env.REDIS_URL! }),
    adapters: {
        telegram: createTelegramAdapter({
            botToken: process.env.TELEGERAM_BOT_TOKEN,
            apiBaseUrl: process.env.TELEGRAM_API_BASE_URL,
            secretToken: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
            userName: process.env.TELEGRAM_BOT_USERNAME
        })
    }
})

bot.onNewMention(async (thread, message) => {
    await thread.post(`You said: ${message.text}`)
})

bot.onNewMessage(/^!help/i, async (thread, message) => {
    await thread.post("Available commands: !help, !status")
})
