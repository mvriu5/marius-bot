import { postThreadError } from "../errors/errorOutput.js"
import { listScheduledReminders, scheduleReminder } from "../lib/reminders.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { Card, CardText } from "chat"
import { parseListOrCreateArgs } from "../lib/commandParsers.js"
import {
    formatReminderDueAt,
    formatReminderRemaining,
    getReminderTimezone,
    isDateToken,
    isDurationToken,
    isTimeToken,
    parseReminderDueAtMs
} from "../lib/dateTimeFormat.js"
import { defineCommandModule } from "./shared/module.js"

type RemindParsedArgs =
    | { mode: "list" }
    | {
        mode: "create"
        durationToken?: string
        dateToken?: string
        timeToken: string
        text: string
    }

const remindCommand: CommandDefinition<"remind", RemindParsedArgs> = {
    name: "remind",
    argPolicy: { type: "any" },
    parseArgs: (args) => parseListOrCreateArgs<{
        durationToken?: string
        dateToken?: string
        timeToken: string
        text: string
    }>(args, {
        parseCreate: (createArgs) => {
            if (createArgs.length < 2) {
                return { ok: false, message: "Nutzung: /remind list oder /remind <duration|time|datetime> <text>" }
            }

            if (isDurationToken(createArgs[0])) {
                const text = createArgs.slice(1).join(" ").trim()
                if (!text) return { ok: false, message: "Bitte gib einen Erinnerungstext an." }
                return { ok: true, value: { durationToken: createArgs[0], timeToken: "00:00", text } }
            }

            if (isTimeToken(createArgs[0])) {
                const text = createArgs.slice(1).join(" ").trim()
                if (!text) return { ok: false, message: "Bitte gib einen Erinnerungstext an." }
                return { ok: true, value: { timeToken: createArgs[0], text } }
            }

            if (createArgs.length >= 3 && isDateToken(createArgs[0]) && isTimeToken(createArgs[1])) {
                const text = createArgs.slice(2).join(" ").trim()
                if (!text) return { ok: false, message: "Bitte gib einen Erinnerungstext an." }
                return { ok: true, value: { dateToken: createArgs[0], timeToken: createArgs[1], text } }
            }

            return { ok: false, message: "Nutzung: /remind list oder /remind <duration|time|datetime> <text>" }
        }
    }),
    execute: async (ctx) => {
        try {
            if (ctx.parsedArgs.mode === "list") {
                const reminders = await listScheduledReminders(ctx.thread.id, ctx.message.author.userId)
                if (reminders.length === 0) {
                    await ctx.thread.post("Keine aktiven Reminder gefunden.")
                    return
                }

                const now = Date.now()
                const lines = reminders.map((reminder, index) => {
                    const dueAt = formatReminderDueAt(reminder.dueAtMs, reminder.timezone)
                    const remaining = formatReminderRemaining(reminder.dueAtMs - now)
                    return `${index + 1}. ${dueAt} (${remaining}) - ${reminder.text}`
                })

                await ctx.thread.post(Card({
                    title: "⏰ Aktive Reminder:",
                    children: [
                        ...lines.map((line) => CardText(line))
                    ]
                }))
                return
            }

            const timezone = getReminderTimezone()
            const dueAtMs = parseReminderDueAtMs(
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

            await ctx.thread.post("🤙 Erinnerung gesetzt!")
        } catch (error) {
            await postThreadError(ctx.thread, error, "Reminder konnte nicht gesetzt werden")
        }
    }
}

export const remind = createCommand(remindCommand)

export const remindModule = defineCommandModule({
    command: remind,
    description: "Setzt eine Erinnerung zu einer Uhrzeit.",
    aliases: ["rm"] as const,
    subcommands: ["list", "<duration|time|datetime> <text>"] as const,
    actionIds: [] as const
})
