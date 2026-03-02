import { Actions, Button, type CardChild } from "chat"

type GridButton = {
    id: string
    label: string
    value?: string
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size))
    }
    return out
}

export function ButtonGrid(opts: {
    buttons: readonly GridButton[]
    columns?: number
}): CardChild[] {
    const columns = Math.max(1, opts.columns ?? 2)
    const rows = chunk(opts.buttons, columns)
    const children: CardChild[] = []

    for (const row of rows) {
        children.push(
            Actions(
                row.map((button) =>
                    Button({
                        id: button.id,
                        label: button.label,
                        value: button.value
                    })
                )
            )
        )
    }

    return children
}
