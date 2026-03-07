import { ProviderError } from "../errors/appError.js"

type TelegramResponse = {
    ok: boolean
    description?: string
}

const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org"

async function telegramRequest(method: string, payload: Record<string, unknown>): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
        throw new ProviderError(
            "telegram",
            "MISSING_BOT_TOKEN",
            "Bot-Token nicht konfiguriert.",
            500,
            "TELEGRAM_BOT_TOKEN environment variable is not set"
        )
    }

    const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })

    const data = (await response.json()) as TelegramResponse

    if (!response.ok || !data.ok) {
        throw new ProviderError(
            "telegram",
            `${method.toUpperCase()}_FAILED`,
            "Telegram-Anfrage fehlgeschlagen.",
            response.status,
            data.description ?? `HTTP ${response.status}`
        )
    }
}

export async function pinMessage(
    chatId: string | number,
    messageId: number,
    disableNotification = true
): Promise<void> {
    await telegramRequest("pinChatMessage", {
        chat_id: chatId,
        message_id: messageId,
        disable_notification: disableNotification
    })
}

export async function unpinMessage(chatId: string | number, messageId?: number): Promise<void> {
    const payload: Record<string, unknown> = { chat_id: chatId }
    if (messageId !== undefined) {
        payload.message_id = messageId
    }
    await telegramRequest("unpinChatMessage", payload)
}

export async function unpinAllMessages(chatId: string | number): Promise<void> {
    await telegramRequest("unpinAllChatMessages", { chat_id: chatId })
}
