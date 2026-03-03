import { ensureStateConnected, state } from "../types/state.js"

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export function createTelegramOAuthKeys(provider: string) {
    const tokenPrefix = `${provider}:token:telegram:`
    const oauthStatePrefix = `${provider}:oauth:state:`

    return {
        tokenKey(telegramUserId: string) {
            return `${tokenPrefix}${telegramUserId}`
        },
        oauthStateKey(stateId: string) {
            return `${oauthStatePrefix}${stateId}`
        }
    }
}

export async function setStateValue<T>(key: string, value: T, ttlMs?: number) {
    await ensureStateConnected()
    if (typeof ttlMs === "number") {
        await state.set<T>(key, value, ttlMs)
        return
    }
    await state.set<T>(key, value)
}

export async function getStateValue<T>(key: string) {
    await ensureStateConnected()
    return state.get<T>(key)
}

export async function deleteStateValue(key: string) {
    await ensureStateConnected()
    await state.delete(key)
}

export function isTokenValid(expiresAt: number | undefined, skewMs = 60_000) {
    if (typeof expiresAt !== "number") return false
    return Date.now() < expiresAt - skewMs
}
