import { postThreadError } from "../errors/errorOutput.js"
import { scheduleReminder } from "../lib/reminders.js"
import { Command, type CommandDefinition } from "../types/command.js"
import { UserError } from "../errors/appError.js"

type RemindParsedArgs = {
    dateToken?: string
    timeToken: string
    text: string
}

function isDateToken(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isTimeToken(value: string) {
    return /^\d{2}:\d{2}$/.test(value)
}

function parseDueAtMs(dateToken: string | undefined, timeToken: string) {
    const [hourText, minuteText] = timeToken.split(":")
    const hour = Number(hourText)
    const minute = Number(minuteText)

    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new UserError("REMINDER_TIME_INVALID", "Uhrzeit ist ungültig.")
    }

    const now = new Date()
    if (!dateToken) {
        const due = new Date(now)
        due.setHours(hour, minute, 0, 0)
        if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1)
        return due.getTime()
    }

    const due = new Date(`${dateToken}T${timeToken}:00`)

    if (Number.isNaN(due.getTime())) {
        throw new UserError("REMINDER_DATE_INVALID", "Datum ist ungültig.")
    }

    if (due.getTime() <= now.getTime()) {
        throw new UserError("REMINDER_TIME_IN_PAST", "Die Erinnerungszeit liegt in der Vergangenheit.")
    }

    return due.getTime()
}

const remindCommand: CommandDefinition<"remind", RemindParsedArgs> = {
    name: "remind",
    argPolicy: { type: "any" },
    parseArgs: (args) => {
        if (args.length < 2) {
            return { ok: false, message: "Nutzung: /remind HH:MM <text> oder /remind YYYY-MM-DD HH:MM <text>" }
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

        return { ok: false, message: "Nutzung: /remind HH:MM <text> oder /remind YYYY-MM-DD HH:MM <text>" }
    },
    execute: async (ctx) => {
        try {
            const dueAtMs = parseDueAtMs(ctx.parsedArgs.dateToken, ctx.parsedArgs.timeToken)
            const reminder = await scheduleReminder({
                threadId: ctx.thread.id,
                userId: ctx.message.author.userId,
                text: ctx.parsedArgs.text,
                dueAtMs,
                timezone: "Europe/Berlin"
            })

            const formatted = new Intl.DateTimeFormat("de-DE", {
                dateStyle: "medium",
                timeStyle: "short"
            }).format(new Date(reminder.dueAtMs))

            await ctx.thread.post(`Erinnerung gesetzt für ${formatted}: ${reminder.text}`)
        } catch (error) {
            await postThreadError(ctx.thread, error, "Reminder konnte nicht gesetzt werden")
        }
    }
}

export const remind = new Command(remindCommand)
