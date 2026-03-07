export type CommandModule<CommandType extends { name: string } = { name: string }> = {
    command: CommandType
    description: string
    aliases: readonly string[]
    subcommands: readonly string[]
    actionIds: readonly string[]
}

export function defineCommandModule<CommandType extends { name: string }>(
    module: CommandModule<CommandType>
) {
    return module
}
