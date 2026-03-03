import { postThreadError } from "../errors/errorOutput.js"
import { scheduleReminder } from "../lib/reminders.js"
import { Command, type CommandDefinition } from "../types/command.js"
import { UserError } from "../errors/appError.js"

type RemindParsedArgs = {
    durationToken?: string
    dateToken?: string
    timeToken: string
    text: string
}

type DateParts = {
    year: number
    month: number
    day: number
}

function isDateToken(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isTimeToken(value: string) {
    return /^\d{2}:\d{2}$/.test(value)
}

function isDurationToken(value: string) {
    return /^\d+(m|h|d)$/i.test(value)
}

function parseDurationToken(durationToken: string) {
    const match = durationToken.trim().toLowerCase().match(/^(\d+)(m|h|d)$/)
    if (!match) {
        throw new UserError("REMINDER_DURATION_INVALID", "Dauer ist ungültig. Nutze z. B. 5m, 1h oder 2d.")
    }

    const amount = Number(match[1])
    const unit = match[2]
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new UserError("REMINDER_DURATION_INVALID", "Dauer muss grösser als 0 sein.")
    }

    const msPerUnit = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000
    return amount * msPerUnit
}

function getReminderTimezone() {
    return process.env.REMINDER_TIMEZONE?.trim() || "Europe/Berlin"
}

function parseTimeToken(timeToken: string) {
    const [hourText, minuteText] = timeToken.split(":")
    const hour = Number(hourText)
    const minute = Number(minuteText)

    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new UserError("REMINDER_TIME_INVALID", "Uhrzeit ist ungueltig.")
    }

    return { hour, minute }
}

function parseDateToken(dateToken: string): DateParts {
    const [yearText, monthText, dayText] = dateToken.split("-")
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)

    const probe = new Date(Date.UTC(year, month - 1, day))
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day
    ) {
        throw new UserError("REMINDER_DATE_INVALID", "Datum ist ungueltig.")
    }

    return { year, month, day }
}

function getTimeZoneOffsetMinutes(timeZone: string, instant: Date) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZoneName: "shortOffset"
    })

    const zonePart = formatter.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value
    if (!zonePart || zonePart === "GMT" || zonePart === "UTC") return 0

    const match = zonePart.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/)
    if (!match) {
        throw new UserError("REMINDER_TIMEZONE_INVALID", `Zeitzone konnte nicht ausgewertet werden: ${timeZone}`)
    }

    const sign = match[1] === "-" ? -1 : 1
    const hours = Number(match[2])
    const minutes = Number(match[3] ?? "0")
    return sign * (hours * 60 + minutes)
}

function zonedDateTimeToUtcMs(parts: DateParts, hour: number, minute: number, timeZone: string) {
    const targetUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0)

    let resolved = targetUtc
    for (let i = 0; i < 3; i += 1) {
        const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, new Date(resolved))
        const next = targetUtc - offsetMinutes * 60_000
        if (next === resolved) break
        resolved = next
    }

    return resolved
}

function getCurrentDatePartsInTimeZone(timeZone: string): DateParts {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    })

    const parts = formatter.formatToParts(new Date())
    const year = Number(parts.find((part) => part.type === "year")?.value)
    const month = Number(parts.find((part) => part.type === "month")?.value)
    const day = Number(parts.find((part) => part.type === "day")?.value)

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        throw new UserError("REMINDER_TIMEZONE_INVALID", `Lokales Datum konnte nicht aus ${timeZone} gelesen werden.`)
    }

    return { year, month, day }
}

function addOneDay(parts: DateParts): DateParts {
    const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
    return {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate()
    }
}

function parseDueAtMs(
    dateToken: string | undefined,
    timeToken: string,
    timeZone: string,
    durationToken?: string
) {
    if (durationToken) {
        const dueAtMs = Date.now() + parseDurationToken(durationToken)
        if (dueAtMs <= Date.now()) {
            throw new UserError("REMINDER_DURATION_INVALID", "Dauer ist ungültig.")
        }
        return dueAtMs
    }

    const { hour, minute } = parseTimeToken(timeToken)
    const nowMs = Date.now()

    if (!dateToken) {
        const today = getCurrentDatePartsInTimeZone(timeZone)
        let dueAtMs = zonedDateTimeToUtcMs(today, hour, minute, timeZone)

        if (dueAtMs <= nowMs) {
            const tomorrow = addOneDay(today)
            dueAtMs = zonedDateTimeToUtcMs(tomorrow, hour, minute, timeZone)
        }

        return dueAtMs
    }

    const dateParts = parseDateToken(dateToken)
    const dueAtMs = zonedDateTimeToUtcMs(dateParts, hour, minute, timeZone)
    if (dueAtMs <= nowMs) {
        throw new UserError("REMINDER_TIME_IN_PAST", "Die Erinnerungszeit liegt in der Vergangenheit.")
    }

    return dueAtMs
}

const remindCommand: CommandDefinition<"remind", RemindParsedArgs> = {
    name: "remind",
    argPolicy: { type: "any" },
    parseArgs: (args) => {
        if (args.length < 2) {
            return { ok: false, message: "Nutzung: /remind <duration|time|datetime> <text>" }
        }

        if (isDurationToken(args[0])) {
            const text = args.slice(1).join(" ").trim()
            if (!text) return { ok: false, message: "Bitte gib einen Erinnerungstext an." }
            return { ok: true, value: { durationToken: args[0], timeToken: "00:00", text } }
        }

        if (isTimeToken(args[0])) {
            const text = args.slice(1).join(" ").trim()
            if (!text) return { ok: false, message: "Bitte gib einen Erinnerungstext an." }
            return { ok: true, value: { timeToken: args[0], text } }
        }

        if (args.length >= 3 && isDateToken(args[0]) && isTimeToken(args[1])) {
            const text = args.slice(2).join(" ").trim()
            if (!text) return { ok: false, message: "Bitte gib einen Erinnerungstext an." }
            return { ok: true, value: { dateToken: args[0], timeToken: args[1], text } }
        }

        return { ok: false, message: "Nutzung: /remind <duration|time|datetime> <text>" }
    },
    execute: async (ctx) => {
        try {
            const timezone = getReminderTimezone()
            const dueAtMs = parseDueAtMs(
                ctx.parsedArgs.dateToken,
                ctx.parsedArgs.timeToken,
                timezone,
                ctx.parsedArgs.durationToken
            )
            await scheduleReminder({
                threadId: ctx.thread.id,
                userId: ctx.message.author.userId,
                text: ctx.parsedArgs.text,
                dueAtMs,
                timezone
            })

            await ctx.thread.post(`🤙 Erinnerung gesetzt!`)
        } catch (error) {
            await postThreadError(ctx.thread, error, "Reminder konnte nicht gesetzt werden")
        }
    }
}

export const remind = new Command(remindCommand)
