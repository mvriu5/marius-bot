import { ensureStateConnected, state } from "../types/state.js"

const AGENT_SESSION_KEY_PREFIX = "agent-session:"
export const AGENT_SESSION_DURATION_MS = 10 * 60 * 1000

function key(threadId: string, userId: string): string {
    return `${AGENT_SESSION_KEY_PREFIX}${threadId}:${userId}`
}

export async function activateAgentSession(threadId: string, userId: string): Promise<number> {
    await ensureStateConnected()
    const expiresAt = Date.now() + AGENT_SESSION_DURATION_MS
    await state.set<number>(key(threadId, userId), expiresAt)
    return expiresAt
}

export async function isAgentSessionActive(threadId: string, userId: string): Promise<boolean> {
    await ensureStateConnected()
    const sessionKey = key(threadId, userId)

    const expiresAt = await state.get<number>(sessionKey)
    if (!expiresAt) return false

    if (Date.now() > expiresAt) {
        await state.delete(sessionKey)
        return false
    }
    return true
}

export async function clearAgentSession(threadId: string, userId: string): Promise<void> {
    await ensureStateConnected()
    await state.delete(key(threadId, userId))
}
