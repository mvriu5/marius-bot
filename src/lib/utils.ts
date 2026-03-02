export function capitalizeFirstLetter(str: string) {
    if (!str) return ""
    return str.charAt(0).toUpperCase() + str.slice(1)
}

export function parseActionToCommand(actionId: string, value?: string): { command: string; args: string[] } {
    const valueParts = (value ?? "").trim().split(/\s+/).filter(Boolean)
    if (valueParts.length > 0) {
        const [command, ...args] = valueParts
        return { command: command.toLowerCase(), args: args.map((arg) => arg.toLowerCase()) }
    }

    if (actionId.startsWith("help:")) {
        return { command: actionId.replace(/^help:/, "").toLowerCase(), args: [] }
    }

    if (actionId.startsWith("command:")) {
        const [, command = "", ...args] = actionId.split(":")
        return { command: command.toLowerCase(), args: args.map((arg) => arg.toLowerCase()) }
    }

    return { command: "", args: [] }
}
