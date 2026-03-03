import type { Hono } from "hono"
import { logError, toHttpError } from "../errors/errorOutput.js"
import {
    deliverReminder,
    parseReminderPayload,
    verifyQstashSignature
} from "../lib/reminders.js"

export function registerQstashRoutes(app: Hono) {
    app.post("/api/qstash/reminder", async (c) => {
        const upstashMessageId = c.req.header("upstash-message-id") ?? "unknown"
        const upstashRegion = c.req.header("upstash-region") ?? "unknown"

        try {
            console.info("[qstash.reminder] callback_received", {
                upstashMessageId,
                upstashRegion
            })

            const body = await c.req.text()
            await verifyQstashSignature({
                signature: c.req.header("upstash-signature"),
                body,
                upstashRegion
            })
            console.info("[qstash.reminder] signature_verified", {
                upstashMessageId,
                upstashRegion
            })

            const payload = parseReminderPayload(JSON.parse(body))
            console.info("[qstash.reminder] payload_parsed", {
                upstashMessageId,
                upstashRegion,
                reminderId: payload.reminderId,
                threadId: payload.threadId,
                dueAtMs: payload.dueAtMs
            })
            await deliverReminder(payload)
            console.info("[qstash.reminder] delivery_sent", {
                upstashMessageId,
                upstashRegion,
                reminderId: payload.reminderId
            })
            return c.json({ ok: true }, 200)
        } catch (error) {
            console.error("[qstash.reminder] callback_failed", {
                upstashMessageId,
                upstashRegion
            })
            logError("qstash.reminder", error)
            const httpError = toHttpError(error)
            return c.json(httpError.body, httpError.status)
        }
    })
}
