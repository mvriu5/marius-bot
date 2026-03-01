import { Message, Thread } from "chat"
import { ensureStateConnected, state } from "../types/state.js"
import { bot } from "../server/bot.js"
import {
    FitbitAuthorizationRequiredError,
    getFitbitDailySummaryMessage
} from "./fitbit.js"
import { getNewsSummaryMessage } from "./news.js"
import { getRememberedWeatherLocation, getWeatherSummaryMessage } from "./weather.js"

const BRIEFING_TARGETS_KEY = "briefing:targets"

type BriefingTargets = Record<string, string>

export async function rememberBriefingTarget(telegramUserId: string, threadId: string) {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}
    targets[telegramUserId] = threadId

    await state.set(BRIEFING_TARGETS_KEY, targets)
}

export async function runDailyBriefing() {
    await ensureStateConnected()

    const targets = (await state.get<BriefingTargets>(BRIEFING_TARGETS_KEY)) ?? {}

    let recipients = 0
    let executed = 0

    for (const [telegramUserId, threadId] of Object.entries(targets)) {
        recipients += 1

        const thread = {
            id: threadId,
            post: async (text: string) => {
                await bot.getAdapter("telegram").postMessage(threadId, text)
            }
        } as unknown as Thread<Record<string, unknown>, unknown>

        const message = {
            text: "---daily-briefing---",
            author: { userId: telegramUserId }
        } as unknown as Message<unknown>

        try {
            const fitbitSummary = await getFitbitDailySummaryMessage(message.author.userId)
            await thread.post(fitbitSummary)
            executed += 1
        } catch (error) {
            if (error instanceof FitbitAuthorizationRequiredError) {
                await thread.post(`Bitte verbinde zuerst Fitbit: ${error.authorizationUrl}`)
            } else {
                const details = error instanceof Error ? error.message : String(error)
                await thread.post(`Daily briefing Fehler bei /fitbit summary: ${details}`)
            }
        }

        try {
            const newsSummary = await getNewsSummaryMessage()
            await thread.post(newsSummary)
            executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /news: ${details}`)
        }

        try {
            const location = await getRememberedWeatherLocation(telegramUserId)
            const weatherSummary = await getWeatherSummaryMessage(location)
            await thread.post(weatherSummary)
            executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /weather: ${details}`)
        }
    }

    return { recipients, executed }
}
