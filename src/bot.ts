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
    await thread.subscribe()
    await thread.post(`You said: ${message.text}`)
    console.log("onNewMention post sent", { threadId: thread.id })
})

bot.onSubscribedMessage(async (thread, message) => {
    console.log("onSubscribedMessage fired", { text: message.text, threadId: thread.id })
    if (message.text.startsWith("/fitbit")) {
        thread.post("You mentioned Fitbit! Here's some info about it: Fitbit is a brand of fitness trackers and smartwatches that help you monitor your health and activity levels. You can track your steps, heart rate, sleep, and more with a Fitbit device.")
    }
    await thread.post(`SUB: You said: ${message.text}`)
    console.log("onSubscribedMessage post sent", { threadId: thread.id })
})
