import { Client, Receiver } from "@upstash/qstash"
import { AuthError, ProviderError, UserError } from "../errors/appError.js"

type ReminderPayload = {
    reminderId: string
    threadId: string
    userId: string
    text: string
    dueAtMs: number
    timezone: string
    createdAtMs: number
}

type ScheduledReminder = ReminderPayload & {
    qstashMessageId: string
}

type ScheduleReminderInput = {
    threadId: string
    userId: string
    text: string
    dueAtMs: number
    timezone: string
}

function requireReminderConfig() {
    const honoUrl = process.env.HONO_URL?.trim()
    if (!honoUrl) {
        throw new ProviderError(
            "qstash",
            "HONO_URL_MISSING",
            "Reminder-Konfiguration ist unvollständig.",
            500,
            "Missing HONO_URL"
        )
    }

    const qstashToken = process.env.QSTASH_TOKEN?.trim()
    if (!qstashToken) {
        throw new ProviderError(
            "qstash",
            "QSTASH_TOKEN_MISSING",
            "Reminder-Konfiguration ist unvollständig.",
            500,
            "Missing QSTASH_TOKEN"
        )
    }

    const qstashUrl = process.env.QSTASH_URL?.trim()
    return {
        callbackUrl: `${honoUrl.replace(/\/+$/, "")}/api/qstash/reminder`,
        qstashToken,
        qstashUrl
    }
}

function getReceiver() {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim()
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim()

    if (!currentSigningKey || !nextSigningKey) {
        throw new ProviderError(
            "qstash",
            "QSTASH_SIGNING_KEYS_MISSING",
            "Reminder-Konfiguration ist unvollständig.",
            500,
            "Missing QSTASH_CURRENT_SIGNING_KEY or QSTASH_NEXT_SIGNING_KEY"
        )
    }

    return new Receiver({ currentSigningKey, nextSigningKey })
}

function newReminderId() {
    return `rem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function scheduleReminder(input: ScheduleReminderInput): Promise<ScheduledReminder> {
    const text = input.text.trim()
    if (!text) {
        throw new UserError("REMINDER_TEXT_MISSING", "Bitte gib einen Erinnerungstext an.")
    }

    const now = Date.now()
    if (input.dueAtMs <= now) {
        throw new UserError("REMINDER_TIME_IN_PAST", "Die Erinnerungszeit liegt in der Vergangenheit.")
    }

    const payload: ReminderPayload = {
        reminderId: newReminderId(),
        threadId: input.threadId,
        userId: input.userId,
        text,
        dueAtMs: input.dueAtMs,
        timezone: input.timezone,
        createdAtMs: now
    }

    const { callbackUrl, qstashToken, qstashUrl } = requireReminderConfig()
    const delaySeconds = Math.ceil((input.dueAtMs - now) / 1000)

    try {
        const client = new Client({
            token: qstashToken,
            ...(qstashUrl ? { baseUrl: qstashUrl } : {})
        })
        const publishResult = await client.publishJSON({
            url: callbackUrl,
            body: payload,
            delay: delaySeconds
        })

        return {
            ...payload,
            qstashMessageId: publishResult.messageId
        }
    } catch (error) {
        throw new ProviderError(
            "qstash",
            "QSTASH_PUBLISH_FAILED",
            "Erinnerung konnte nicht geplant werden.",
            502,
            error instanceof Error ? error.message : String(error),
            error
        )
    }

}

export async function verifyQstashSignature(input: {
    signature: string | undefined
    body: string
    upstashRegion?: string
}) {
    if (!input.signature) {
        throw new AuthError(
            "QSTASH_SIGNATURE_MISSING",
            "Nicht autorisierter Reminder-Callback.",
            401
        )
    }

    const receiver = getReceiver()
    const isValid = await receiver.verify({
        signature: input.signature,
        body: input.body,
        upstashRegion: input.upstashRegion
    })

    if (!isValid) {
        throw new AuthError(
            "QSTASH_SIGNATURE_INVALID",
            "Nicht autorisierter Reminder-Callback.",
            401
        )
    }
}

export function parseReminderPayload(value: unknown): ReminderPayload {
    if (!value || typeof value !== "object") {
        throw new UserError("REMINDER_PAYLOAD_INVALID", "Reminder-Payload ist ungültig.")
    }

    const payload = value as Partial<ReminderPayload>
    if (!payload.reminderId || !payload.threadId || !payload.userId || !payload.text || !payload.dueAtMs || !payload.timezone || !payload.createdAtMs) {
        throw new UserError("REMINDER_PAYLOAD_INVALID", "Reminder-Payload ist unvollständig.")
    }

    return {
        reminderId: String(payload.reminderId),
        threadId: String(payload.threadId),
        userId: String(payload.userId),
        text: String(payload.text),
        dueAtMs: Number(payload.dueAtMs),
        timezone: String(payload.timezone),
        createdAtMs: Number(payload.createdAtMs)
    }
}

export async function deliverReminder(payload: ReminderPayload) {
    const { bot } = await import("../server/bot.js")
    const adapter = bot.getAdapter("telegram")
    await adapter.postMessage(payload.threadId, `🕑 Erinnerung: ${payload.text}` as never)
}
