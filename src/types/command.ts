import { Message, Thread } from "chat"

export type CommandContext<
    Name extends string = string,
    Args extends readonly string[] = readonly string[]
> = {
    thread: Thread<Record<string, unknown>, unknown>
    message: Message<unknown>
    command: Name
    args: Args
}

export type CommandArgPolicy<Args extends readonly string[] = readonly string[]> =
    | { type: "none" }
    | { type: "any" }
    | { type: "tuple"; length: Args["length"] }
    | { type: "max"; max: number }
    | { type: "range"; min: number; max: number }

export type CommandDefinition<
    Name extends string,
    Args extends readonly string[] = readonly string[]
> = {
    name: Name
    execute: (ctx: CommandContext<Name, Args>) => Promise<void>
    argPolicy?: CommandArgPolicy<Args>
}

export class Command<
    Name extends string = string,
    Args extends readonly string[] = readonly string[]
> {
    public readonly name: Name
    private readonly handler: (ctx: CommandContext<Name, Args>) => Promise<void>
    public readonly argPolicy: CommandArgPolicy<Args>

    constructor(init: CommandDefinition<Name, Args>) {
        this.name = init.name
        this.handler = init.execute
        this.argPolicy = init.argPolicy ?? { type: "any" }
    }

    validateArgs(args: readonly string[]): args is Args {
        if (this.argPolicy.type === "any") return true
        if (this.argPolicy.type === "none") return args.length === 0
        if (this.argPolicy.type === "tuple") return args.length === this.argPolicy.length
        if (this.argPolicy.type === "max") return args.length <= this.argPolicy.max
        return args.length >= this.argPolicy.min && args.length <= this.argPolicy.max
    }

    async execute(ctx: CommandContext): Promise<void> {
        await this.handler(ctx as CommandContext<Name, Args>)
    }
}
