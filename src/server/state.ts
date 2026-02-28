import { createRedisState } from "@chat-adapter/state-redis"

const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error("Missing REDIS_URL")

export const state = createRedisState({ url: redisUrl })

let connectPromise: Promise<void> | null = null

export async function ensureStateConnected() {
    if (!connectPromise) {
        connectPromise = state.connect().catch((error) => {
            connectPromise = null
            throw error
        })
    }

    await connectPromise
}
