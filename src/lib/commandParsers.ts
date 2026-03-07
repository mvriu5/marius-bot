import { type CommandParseResult } from "../types/command.js"
import { getCurrentDateStrInTimeZone, isDateToken, isTimeToken } from "./dateTimeFormat.js"

export function parseNoArgs(): CommandParseResult<{}> {
    return { ok: true, value: {} }
}

export function parseOptionalJoinedArg<Key extends string>(
    args: readonly string[],
    key: Key
): CommandParseResult<Record<Key, string | undefined>> {
    const joined = args.join(" ").trim()
    return {
        ok: true,
        value: {
            [key]: joined || undefined
        } as Record<Key, string | undefined>
    }
}

export function parseEnumArg<Action extends string>(
    args: readonly string[],
    options: {
        allowedValues: readonly Action[]
        unknownValueMessage: string
    }
): CommandParseResult<{ action: Action }> {
    const action = args[0]
    if (action && options.allowedValues.includes(action as Action)) {
        return { ok: true, value: { action: action as Action } }
    }
    return { ok: false, message: options.unknownValueMessage }
}

export function parseDateTimeTitleArgs(args: readonly string[], options?: { timeZone?: string }): CommandParseResult<{
    startLocalStr: string
    title: string
}> {
    const usageMessage = "Nutzung: /event HH:MM <titel> oder /event YYYY-MM-DD HH:MM <titel>"

    if (args.length < 2) {
        return { ok: false, message: usageMessage }
    }

    if (args.length >= 3 && isDateToken(args[0]) && isTimeToken(args[1])) {
        const [dateStr, timeStr, ...titleParts] = args
        const title = titleParts.join(" ").trim()
        if (!title) return { ok: false, message: "Bitte gib einen Event-Titel an." }
        return { ok: true, value: { startLocalStr: `${dateStr}T${timeStr}:00`, title } }
    }

    if (isTimeToken(args[0])) {
        const [timeStr, ...titleParts] = args
        const title = titleParts.join(" ").trim()
        if (!title) return { ok: false, message: "Bitte gib einen Event-Titel an." }
        const dateStr = getCurrentDateStrInTimeZone(options?.timeZone ?? "Europe/Berlin")
        return { ok: true, value: { startLocalStr: `${dateStr}T${timeStr}:00`, title } }
    }

    return { ok: false, message: usageMessage }
}

export function parseListOrCreateArgs<Create>(
    args: readonly string[],
    options: {
        listKeyword?: string
        parseCreate: (args: readonly string[]) => CommandParseResult<Create>
    }
): CommandParseResult<{ mode: "list" } | ({ mode: "create" } & Create)> {
    const listKeyword = options.listKeyword ?? "list"
    if (args.length === 1 && args[0].toLowerCase() === listKeyword) {
        return { ok: true, value: { mode: "list" } }
    }

    const parsedCreate = options.parseCreate(args)
    if (!parsedCreate.ok) return parsedCreate
    return { ok: true, value: { mode: "create", ...parsedCreate.value } }
}
