import { ensureStateConnected, state } from "../types/state.js"

const MESSAGE_HISTORY_KEY_PREFIX = "message-history:"

function historyKey(threadId: string): string {
    return `${MESSAGE_HISTORY_KEY_PREFIX}${threadId}`
}

export async function trackMessage(threadId: string, messageId: string): Promise<void> {
    await ensureStateConnected()
    const key = historyKey(threadId)
    const existing = (await state.get<string[]>(key)) ?? []
    if (!existing.includes(messageId)) {
        await state.set(key, [...existing, messageId])
    }
}

export async function getMessageIds(threadId: string): Promise<string[]> {
    await ensureStateConnected()
    return (await state.get<string[]>(historyKey(threadId))) ?? []
}

export async function clearMessageHistory(threadId: string): Promise<void> {
    await ensureStateConnected()
    await state.delete(historyKey(threadId))
}
