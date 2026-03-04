import type { Hono } from "hono"
import { logError, toHttpError } from "../errors/errorOutput.js"
import {
    deliverReminder,
    parseReminderPayload,
    verifyQstashSignature
} from "../lib/reminders.js"
import {
    parseCopilotPollPayload,
    processCopilotPoll
} from "../lib/copilotTasks.js"

export function registerQstashRoutes(app: Hono) {
    app.post("/api/qstash/reminder", async (c) => {
        const upstashMessageId = c.req.header("upstash-message-id") ?? "unknown"
        const upstashRegion = c.req.header("upstash-region") ?? "unknown"

        try {
            const body = await c.req.text()
            await verifyQstashSignature({
                signature: c.req.header("upstash-signature"),
                body,
                upstashRegion
            })

            const payload = parseReminderPayload(JSON.parse(body))
            await deliverReminder(payload)
            return c.json({ ok: true, upstashMessageId }, 200)
        } catch (error) {
            logError("qstash.reminder", error)
            const httpError = toHttpError(error)
            return c.json(httpError.body, httpError.status)
        }
    })

    app.post("/api/qstash/copilot", async (c) => {
        const upstashMessageId = c.req.header("upstash-message-id") ?? "unknown"
        const upstashRegion = c.req.header("upstash-region") ?? "unknown"

        try {
            const body = await c.req.text()
            await verifyQstashSignature({
                signature: c.req.header("upstash-signature"),
                body,
                upstashRegion
            })

            const payload = parseCopilotPollPayload(JSON.parse(body))
            await processCopilotPoll(payload)
            return c.json({ ok: true, upstashMessageId }, 200)
        } catch (error) {
            logError("qstash.copilot", error)
            const httpError = toHttpError(error)
            return c.json(httpError.body, httpError.status)
        }
    })
}
