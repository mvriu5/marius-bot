import { UserError } from "../errors/appError.js"

type DateParts = {
    year: number
    month: number
    day: number
}

export function isDateToken(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function isTimeToken(value: string) {
    return /^\d{2}:\d{2}$/.test(value)
}

export function isDurationToken(value: string) {
    return /^\d+(m|h|d)$/i.test(value)
}

export function formatMinutesCompact(totalMinutes: number) {
    if (!totalMinutes || totalMinutes <= 0) return "0m"
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0) return `${minutes}m`
    return `${hours}h ${minutes}m`
}

export function formatPercent(value: number | null) {
    return value === null || Number.isNaN(value) ? "n/a" : `${value.toFixed(1)}%`
}

export function formatSecondsHuman(value: number | null) {
    if (value === null || Number.isNaN(value)) return "n/a"
    const rounded = Math.round(value)
    const mins = Math.floor(rounded / 60)
    const secs = rounded % 60
    if (mins <= 0) return `${secs}s`
    return `${mins}m ${secs}s`
}

export function formatTemperatureC(value: number | undefined) {
    return value === undefined || Number.isNaN(value) ? "n/a" : `${value.toFixed(1)}C`
}

export function getCurrentDateStrInTimeZone(timeZone: string): string {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date())
}

export function addHoursToLocalDateTimeStr(localStr: string, hours: number): string {
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

export function formatLocalDateTime(localStr: string): string {
    const [datePart, timePart] = localStr.split("T")
    const [year, month, day] = datePart.split("-")
    const [hour, minute] = timePart.split(":")
    return `${day}.${month}.${year} ${hour}:${minute}`
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

export function getReminderTimezone() {
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

export function parseReminderDueAtMs(
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

export function formatReminderDueAt(dueAtMs: number, timezone: string) {
    try {
        return new Intl.DateTimeFormat("de-DE", {
            timeZone: timezone,
            dateStyle: "medium",
            timeStyle: "short"
        }).format(new Date(dueAtMs))
    } catch {
        return new Date(dueAtMs).toISOString()
    }
}

export function formatReminderRemaining(remainingMs: number) {
    if (remainingMs <= 0) return "jetzt"

    const totalMinutes = Math.ceil(remainingMs / 60_000)
    const days = Math.floor(totalMinutes / (24 * 60))
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
    const minutes = totalMinutes % 60

    const parts: string[] = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)

    return `in ${parts.join(" ")}`
}
