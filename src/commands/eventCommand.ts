import { Card, CardText } from "chat"
import { ButtonGrid } from "../ui/buttonGrid.js"
import { postThreadError } from "../errors/errorOutput.js"
import {
    GoogleAuthorizationRequiredError,
    createCalendarEventForUser,
    createGoogleAuthorizationUrl,
    isGoogleCalendarConnected
} from "../integrations/googleCalendar.js"
import {
    addHoursToLocalDateTimeStr,
    formatLocalDateTime
} from "../lib/dateTimeFormat.js"
import { parseDateTimeTitleArgs } from "../lib/commandParsers.js"
import { deleteStateValue, getStateValue, setStateValue } from "../oauth/oauthState.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { ACTION_IDS } from "./shared/actionIds.js"
import { postOAuthLoginCard } from "../ui/oauthCards.js"
import { defineCommandModule } from "./shared/module.js"

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

function formatDurationLabel(hours: DurationOption): string {
    if (hours === 0.5) return "30 min"
    if (hours === 1) return "1 Std"
    if (hours === 1.5) return "1,5 Std"
    if (hours === 2) return "2 Std"
    if (hours === 2.5) return "2,5 Std"
    return "3 Std"
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

        const parsedDateTime = parseDateTimeTitleArgs(args, { timeZone: EVENT_TIMEZONE })
        if (!parsedDateTime.ok) return parsedDateTime

        return {
            ok: true,
            value: {
                mode: "picker",
                startLocalStr: parsedDateTime.value.startLocalStr,
                titel: parsedDateTime.value.title
            }
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
                    await postOAuthLoginCard(ctx.thread, {
                        title: "Google Login",
                        text: "Bitte verbinde zuerst Google Calendar:",
                        authorizationUrl
                    })
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
                            CardText(`Startzeit: ${formatLocalDateTime(startLocalStr)}`),
                            CardText("Wähle die Dauer:"),
                        ...ButtonGrid({
                            buttons: DURATION_OPTIONS.map((hours) => ({
                                id: ACTION_IDS.event.confirm,
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
            const endLocalStr = addHoursToLocalDateTimeStr(pendingEvent.startLocalStr, durationHours)

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
                            `${formatLocalDateTime(pendingEvent.startLocalStr)} – ${formatLocalDateTime(endLocalStr)}`
                        )
                    ]
                })
            )
        } catch (error) {
            if (error instanceof GoogleAuthorizationRequiredError) {
                await postOAuthLoginCard(ctx.thread, {
                    title: "Google Login",
                    text: "Bitte verbinde Google Calendar erneut (neue Berechtigungen erforderlich):",
                    authorizationUrl: error.authorizationUrl
                })
                return
            }
            await postThreadError(ctx.thread, error, "Event konnte nicht erstellt werden")
        }
    }
}

export const event = createCommand(eventCommand)

export const eventModule = defineCommandModule({
    command: event,
    description: "Erstellt ein Google Calendar Event mit Dauer-Auswahl.",
    aliases: ["ev"] as const,
    subcommands: ["HH:MM <titel>", "YYYY-MM-DD HH:MM <titel>"] as const,
    actionIds: [ACTION_IDS.event.confirm] as const
})
