import { Message, Thread } from "chat"

export type RawCommandContext<
    Name extends string = string
> = {
    thread: Thread<Record<string, unknown>, unknown>
    message: Message<unknown>
    source?: "message" | "action"
    actionMessageId?: string
    command: Name
    args: readonly string[]
}

export type ParsedCommandContext<
    Name extends string = string,
    ParsedArgs = unknown
> = RawCommandContext<Name> & {
    parsedArgs: ParsedArgs
}

export type CommandParseResult<ParsedArgs> =
    | { ok: true; value: ParsedArgs }
    | { ok: false; message: string }

export type CommandArgPolicy =
    | { type: "none" }
    | { type: "any" }
    | { type: "tuple"; length: number }
    | { type: "max"; max: number }
    | { type: "range"; min: number; max: number }

export type CommandDefinition<
    Name extends string,
    ParsedArgs = unknown
> = {
    name: Name
    execute: (ctx: ParsedCommandContext<Name, ParsedArgs>) => Promise<void>
    parseArgs?: (args: readonly string[]) => CommandParseResult<ParsedArgs>
    argPolicy?: CommandArgPolicy
}

export class Command<
    Name extends string = string,
    ParsedArgs = unknown
> {
    public readonly name: Name
    private readonly handler: (ctx: ParsedCommandContext<Name, ParsedArgs>) => Promise<void>
    private readonly parser: (args: readonly string[]) => CommandParseResult<ParsedArgs>
    public readonly argPolicy: CommandArgPolicy

    constructor(init: CommandDefinition<Name, ParsedArgs>) {
        this.name = init.name
        this.handler = init.execute
        this.parser = init.parseArgs ?? ((args) => ({ ok: true, value: args as ParsedArgs }))
        this.argPolicy = init.argPolicy ?? { type: "any" }
    }

    validateArgs(args: readonly string[]) {
        if (this.argPolicy.type === "any") return true
        if (this.argPolicy.type === "none") return args.length === 0
        if (this.argPolicy.type === "tuple") return args.length === this.argPolicy.length
        if (this.argPolicy.type === "max") return args.length <= this.argPolicy.max
        return args.length >= this.argPolicy.min && args.length <= this.argPolicy.max
    }

    parseArgs(args: readonly string[]) {
        return this.parser(args)
    }

    async execute(ctx: RawCommandContext, parsedArgs: unknown): Promise<void> {
        await this.handler({
            ...(ctx as RawCommandContext<Name>),
            parsedArgs: parsedArgs as ParsedArgs
        })
    }
}
