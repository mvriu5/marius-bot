import { Chat } from "chat"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import { FitbitAuthorizationRequiredError, getFitbitDailySummaryMessage } from "./fitbit.js"
import { state } from "./state.js"

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

bot.onNewMention(async (thread, message) => {
    await thread.subscribe()
    await thread.post(`You said: ${message.text}`)
})

bot.onSubscribedMessage(async (thread, message) => {
    if (message.text.startsWith("/fitbit")) {
        try {
            const summary = await getFitbitDailySummaryMessage(message.author.userId)
            await thread.post(summary)
        } catch (error) {
            if (error instanceof FitbitAuthorizationRequiredError) {
                await thread.post(
                    `Bitte verbinde zuerst Fitbit: ${error.authorizationUrl}`
                )
                return
            }

            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Fitbit konnte nicht geladen werden: ${details}`)
        }
    }
})
