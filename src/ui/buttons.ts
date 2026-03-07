export function definedButtons<T>(items: Array<T | false | null | undefined>): T[] {
    return items.filter((item): item is T => Boolean(item))
}
