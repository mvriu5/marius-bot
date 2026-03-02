import { Message, Thread } from "chat"
import { ensureStateConnected, state } from "../types/state.js"
import { bot } from "../server/bot.js"
import {
    FitbitAuthorizationRequiredError,
    getFitbitDailySummaryMessage
} from "./fitbit.js"
import {
    GoogleAuthorizationRequiredError,
    getTodayCalendarSummaryMessage
} from "./googleCalendar.js"
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
            text: "---DAILY-BRIEFING---",
            author: { userId: telegramUserId }
        } as unknown as Message<unknown>

        try {
            const fitbitSummary = await getFitbitDailySummaryMessage(message.author.userId)
            const formatMinutes = (totalMinutes: number) => {
                if (!totalMinutes || totalMinutes <= 0) return "0m"
                const hours = Math.floor(totalMinutes / 60)
                const minutes = totalMinutes % 60
                if (hours === 0) return `${minutes}m`
                return `${hours}h ${minutes}m`
            }

            const lines = [
                "Fitbit Tagesuebersicht:",
                `- Sleep Score: ${fitbitSummary.sleepScore ?? "n/a"}`,
                `- Schlaf: ${formatMinutes(fitbitSummary.totalMinutesAsleep)} (im Bett: ${formatMinutes(fitbitSummary.totalTimeInBed)})`,
                `- HRV (daily RMSSD): ${fitbitSummary.hrvDailyRmssd ?? "n/a"} ms`,
                `- HRV (deep RMSSD): ${fitbitSummary.hrvDeepRmssd ?? "n/a"} ms`,
                `- Tiefste Herzfrequenz: ${fitbitSummary.lowestHeartRate ?? "n/a"} bpm`
            ]
            await thread.post(lines.join("\n"))
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
            const lines = [
                `News Briefing (${newsSummary.items.length} Meldungen):`,
                ...newsSummary.items.map((item, index) => `${index + 1}. [${item.category}] ${item.title}\n${item.link}`)
            ]
            if (newsSummary.errors.length > 0) {
                lines.push("")
                lines.push(`Hinweis: ${newsSummary.errors.length} Feed(s) konnten nicht geladen werden.`)
            }
            await thread.post(lines.join("\n"))
            executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /news: ${details}`)
        }

        try {
            const meetingsSummary = await getTodayCalendarSummaryMessage(message.author.userId)
            await thread.post(meetingsSummary)
            executed += 1
        } catch (error) {
            if (error instanceof GoogleAuthorizationRequiredError) {
                await thread.post(`Bitte verbinde zuerst Google Calendar: ${error.authorizationUrl}`)
            } else {
                const details = error instanceof Error ? error.message : String(error)
                await thread.post(`Daily briefing Fehler bei /meetings summary: ${details}`)
            }
        }

        try {
            const location = await getRememberedWeatherLocation(telegramUserId)
            const weatherSummary = await getWeatherSummaryMessage(location)
            const formatTemp = (value: number | undefined) =>
                value === undefined || Number.isNaN(value) ? "n/a" : `${value.toFixed(1)}C`
            const lines = [
                `Wetter (${weatherSummary.locationLabel}):`,
                `- Zustand: ${weatherSummary.condition}`,
                `- Jetzt: ${formatTemp(weatherSummary.temperatureC)} (gefuehlt ${formatTemp(weatherSummary.apparentTemperatureC)})`,
                `- Wind: ${weatherSummary.windSpeedKmh ?? "n/a"} km/h`,
                `- Heute min/max: ${formatTemp(weatherSummary.minTempC)} / ${formatTemp(weatherSummary.maxTempC)}`,
                `- Regenwahrscheinlichkeit: ${weatherSummary.precipitationProbabilityPct ?? "n/a"} %`
            ]
            await thread.post(lines.join("\n"))
            executed += 1
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error)
            await thread.post(`Daily briefing Fehler bei /weather: ${details}`)
        }
    }

    return { recipients, executed }
}
