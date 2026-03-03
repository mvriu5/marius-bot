import type { Hono } from "hono"
import { logError, toHttpError } from "../errors/errorOutput.js"
import {
    deliverReminder,
    parseReminderPayload,
    verifyQstashSignature
} from "../lib/reminders.js"

export function registerQstashRoutes(app: Hono) {
    app.post("/api/qstash/reminder", async (c) => {
        try {
            const body = await c.req.text()
            await verifyQstashSignature({
                signature: c.req.header("upstash-signature"),
                body,
                upstashRegion: c.req.header("upstash-region")
            })

            const payload = parseReminderPayload(JSON.parse(body))
            await deliverReminder(payload)
            return c.json({ ok: true }, 200)
        } catch (error) {
            logError("qstash.reminder", error)
            const httpError = toHttpError(error)
            return c.json(httpError.body, httpError.status)
        }
    })
}
