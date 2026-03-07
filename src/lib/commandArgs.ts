import { type CommandParseResult } from "../types/command.js"
import { parseEnumArg } from "./commandParsers.js"

export function parseMenuActionArgs<
    DefaultAction extends string,
    Action extends string
>(
    args: readonly string[],
    options: {
        defaultAction: DefaultAction
        allowedActions: readonly Action[]
        unknownActionMessage: string
    }
): CommandParseResult<{ action: DefaultAction | Action }> {
    const action = args[0]
    if (!action) {
        return { ok: true, value: { action: options.defaultAction } }
    }

    const parsedAction = parseEnumArg(args, {
        allowedValues: options.allowedActions,
        unknownValueMessage: options.unknownActionMessage
    })
    if (parsedAction.ok) {
        return { ok: true, value: { action: parsedAction.value.action } }
    }

    return { ok: false, message: options.unknownActionMessage }
}
