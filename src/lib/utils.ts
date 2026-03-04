export function capitalizeFirstLetter(str: string) {
    if (!str) return ""
    return str.charAt(0).toUpperCase() + str.slice(1)
}

export function parseActionToCommand(actionId: string, value?: string): { command: string; args: string[] } {
    const valueParts = (value ?? "").trim().split(/\s+/).filter(Boolean)
    const normalize = (parts: string[]) => parts.map((part) => part.toLowerCase())

    const parseCommandLikeActionId = (prefix: string) => {
        if (!actionId.startsWith(prefix)) return null
        const [, command = "", ...actionArgs] = actionId.split(":")
        const normalizedCommand = command.toLowerCase()
        const normalizedActionArgs = normalize(actionArgs)
        const normalizedValueParts = normalize(valueParts)

        if (normalizedValueParts.length > 0) {
            // Backward compatibility: existing buttons may still send full command text in value.
            if (normalizedValueParts[0] === normalizedCommand) {
                return {
                    command: normalizedCommand,
                    args: normalizedValueParts.slice(1)
                }
            }

            return {
                command: normalizedCommand,
                args: [...normalizedActionArgs, ...normalizedValueParts]
            }
        }

        return {
            command: normalizedCommand,
            args: normalizedActionArgs
        }
    }

    const compactCommand = parseCommandLikeActionId("c:")
    if (compactCommand) return compactCommand

    const commandAction = parseCommandLikeActionId("command:")
    if (commandAction) return commandAction

    if (valueParts.length > 0) {
        const [command, ...args] = valueParts
        return { command: command.toLowerCase(), args: normalize(args) }
    }

    if (actionId.startsWith("help:")) {
        return { command: actionId.replace(/^help:/, "").toLowerCase(), args: [] }
    }

    return { command: "", args: [] }
}
