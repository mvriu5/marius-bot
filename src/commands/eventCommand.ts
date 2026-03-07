import { Actions, Card, CardText, LinkButton } from "chat"
import { ButtonGrid } from "../components/buttonGrid.js"
import { postThreadError } from "../errors/errorOutput.js"
import {
    GoogleAuthorizationRequiredError,
    createCalendarEventForUser,
    createGoogleAuthorizationUrl,
    isGoogleCalendarConnected
} from "../lib/googleCalendar.js"
import { deleteStateValue, getStateValue, setStateValue } from "../oauth/oauthState.js"
import { Command, type CommandDefinition } from "../types/command.js"

const EVENT_TIMEZONE = "Europe/Berlin"
const EVENT_STATE_TTL_MS = 60 * 60 * 1000

type PendingEventState = {
    startLocalStr: string
    titel: string
    telegramUserId: string
}

type EventParsedArgs =
    | { mode: "picker"; startLocalStr: string; titel: string }
    | { mode: "confirm"; stateId: string; durationHours: number }

const DURATION_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3] as const
type DurationOption = (typeof DURATION_OPTIONS)[number]

function eventStateKey(stateId: string) {
    return `event:pending:${stateId}`
}

function createEventStateId() {
    // Keep callback payloads small enough for Telegram callback_data (64 bytes max).
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12)
}

function isTimeToken(value: string) {
    return /^\d{2}:\d{2}$/.test(value)
}

function isDateToken(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function getCurrentDateStrInTimeZone(timeZone: string): string {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date())
}

function formatDurationLabel(hours: DurationOption): string {
    if (hours === 0.5) return "30 min"
    if (hours === 1) return "1 Std"
    if (hours === 1.5) return "1,5 Std"
    if (hours === 2) return "2 Std"
    if (hours === 2.5) return "2,5 Std"
    return "3 Std"
}

function addHoursToLocalStr(localStr: string, hours: number): string {
    // localStr must be in "YYYY-MM-DDTHH:MM:00" format
    const [datePart, timePart] = localStr.split("T")
    const [hourStr, minuteStr] = timePart.split(":")
    const startMinutes = Number(hourStr) * 60 + Number(minuteStr)
    const totalMinutes = startMinutes + Math.round(hours * 60)

    const extraDays = Math.floor(totalMinutes / (24 * 60))
    const remainingMinutes = totalMinutes % (24 * 60)
    const endHour = Math.floor(remainingMinutes / 60)
    const endMinute = remainingMinutes % 60

    let finalDatePart = datePart
    if (extraDays > 0) {
        const [year, month, day] = datePart.split("-").map(Number)
        const next = new Date(Date.UTC(year, month - 1, day + extraDays))
        finalDatePart = [
            next.getUTCFullYear(),
            String(next.getUTCMonth() + 1).padStart(2, "0"),
            String(next.getUTCDate()).padStart(2, "0")
        ].join("-")
    }

    const hh = String(endHour).padStart(2, "0")
    const mm = String(endMinute).padStart(2, "0")
    return `${finalDatePart}T${hh}:${mm}:00`
}

function formatLocalStr(localStr: string): string {
    const [datePart, timePart] = localStr.split("T")
    const [year, month, day] = datePart.split("-")
    const [hour, minute] = timePart.split(":")
    return `${day}.${month}.${year} ${hour}:${minute}`
}

const eventCommand: CommandDefinition<"event", EventParsedArgs> = {
    name: "event",
    argPolicy: { type: "any" },
    parseArgs: (args) => {
        if (args[0] === "confirm" && args.length === 3) {
            const stateId = args[1]
            const durationHours = Number(args[2])
            if (!stateId || !DURATION_OPTIONS.includes(durationHours as DurationOption)) {
                return { ok: false, message: "Ungültige Event-Bestätigung." }
            }
            return { ok: true, value: { mode: "confirm", stateId, durationHours } }
        }

        if (args.length < 2) {
            return {
                ok: false,
                message: "Nutzung: /event HH:MM <titel> oder /event YYYY-MM-DD HH:MM <titel>"
            }
        }

        if (args.length >= 3 && isDateToken(args[0]) && isTimeToken(args[1])) {
            const [dateStr, timeStr, ...titleParts] = args
            const titel = titleParts.join(" ").trim()
            if (!titel) {
                return { ok: false, message: "Bitte gib einen Event-Titel an." }
            }
            return {
                ok: true,
                value: { mode: "picker", startLocalStr: `${dateStr}T${timeStr}:00`, titel }
            }
        }

        if (isTimeToken(args[0])) {
            const [timeStr, ...titleParts] = args
            const titel = titleParts.join(" ").trim()
            if (!titel) {
                return { ok: false, message: "Bitte gib einen Event-Titel an." }
            }
            const dateStr = getCurrentDateStrInTimeZone(EVENT_TIMEZONE)
            return {
                ok: true,
                value: { mode: "picker", startLocalStr: `${dateStr}T${timeStr}:00`, titel }
            }
        }

        return {
            ok: false,
            message: "Nutzung: /event HH:MM <titel> oder /event YYYY-MM-DD HH:MM <titel>"
        }
    },
    execute: async (ctx) => {
        const userId = ctx.message.author.userId

        if (ctx.parsedArgs.mode === "picker") {
            const { startLocalStr, titel } = ctx.parsedArgs

            const connected = await isGoogleCalendarConnected(userId)
            if (!connected) {
                try {
                    const authorizationUrl = await createGoogleAuthorizationUrl(userId)
                    await ctx.thread.post(
                        Card({
                            title: "Google Login",
                            children: [
                                CardText("Bitte verbinde zuerst Google Calendar:"),
                                Actions([LinkButton({ url: authorizationUrl, label: "Login" })])
                            ]
                        })
                    )
                } catch (error) {
                    await postThreadError(ctx.thread, error, "Google Login konnte nicht gestartet werden")
                }
                return
            }

            const stateId = createEventStateId()
            await setStateValue<PendingEventState>(
                eventStateKey(stateId),
                { startLocalStr, titel, telegramUserId: userId },
                EVENT_STATE_TTL_MS
            )

            await ctx.thread.post(
                Card({
                    title: `📅 Event: ${titel}`,
                    children: [
                        CardText(`Startzeit: ${formatLocalStr(startLocalStr)}`),
                        CardText("Wähle die Dauer:"),
                        ...ButtonGrid({
                            buttons: DURATION_OPTIONS.map((hours) => ({
                                id: "c:event:confirm",
                                label: formatDurationLabel(hours),
                                value: `${stateId} ${hours}`
                            }))
                        })
                    ]
                })
            )
            return
        }

        const { stateId, durationHours } = ctx.parsedArgs
        const pendingEvent = await getStateValue<PendingEventState>(eventStateKey(stateId))

        if (!pendingEvent) {
            await ctx.thread.post("Event nicht mehr gültig. Bitte neu anlegen mit /event.")
            return
        }

        if (ctx.actionMessageId) {
            try {
                await ctx.thread
                    .createSentMessageFromMessage(
                        { ...ctx.message, id: ctx.actionMessageId } as typeof ctx.message
                    )
                    .delete()
            } catch {
                // ignore delete errors
            }
        }

        try {
            const endLocalStr = addHoursToLocalStr(pendingEvent.startLocalStr, durationHours)

            await deleteStateValue(eventStateKey(stateId))

            await createCalendarEventForUser(userId, {
                summary: pendingEvent.titel,
                startLocalStr: pendingEvent.startLocalStr,
                endLocalStr,
                timeZone: EVENT_TIMEZONE
            })

            await ctx.thread.post(
                Card({
                    title: "✅ Event erstellt",
                    children: [
                        CardText(pendingEvent.titel),
                        CardText(
                            `${formatLocalStr(pendingEvent.startLocalStr)} – ${formatLocalStr(endLocalStr)}`
                        )
                    ]
                })
            )
        } catch (error) {
            if (error instanceof GoogleAuthorizationRequiredError) {
                await ctx.thread.post(
                    Card({
                        title: "Google Login",
                        children: [
                            CardText("Bitte verbinde Google Calendar erneut (neue Berechtigungen erforderlich):"),
                            Actions([LinkButton({ url: error.authorizationUrl, label: "Login" })])
                        ]
                    })
                )
                return
            }
            await postThreadError(ctx.thread, error, "Event konnte nicht erstellt werden")
        }
    }
}

export const event = new Command(eventCommand)
