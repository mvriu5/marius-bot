type OpenMeteoResponse = {
    current?: {
        temperature_2m?: number
        apparent_temperature?: number
        weather_code?: number
        wind_speed_10m?: number
    }
    daily?: {
        time?: string[]
        temperature_2m_min?: number[]
        temperature_2m_max?: number[]
        precipitation_probability_max?: number[]
        weather_code?: number[]
    }
}

import { ensureStateConnected, state } from "../types/state.js"
import { ProviderError, UserError } from "../errors/appError.js"

type GeocodingResponse = {
    results?: Array<{
        name?: string
        latitude?: number
        longitude?: number
        country?: string
    }>
}

const DEFAULT_LOCATION = {
    label: "Berlin",
    latitude: 52.52,
    longitude: 13.41
}
const WEATHER_LOCATION_KEY_PREFIX = "weather:last-location:"

type WeatherSummary = {
    locationLabel: string
    condition: string
    conditionEmoji: string
    temperatureC?: number
    apparentTemperatureC?: number
    windSpeedKmh?: number
    minTempC?: number
    maxTempC?: number
    precipitationProbabilityPct?: number
}

function weatherCodeToText(code: number | undefined) {
    const map: Record<number, string> = {
        0: "Klar",
        1: "Ueberwiegend klar",
        2: "Teilweise bewoelkt",
        3: "Bewoelkt",
        45: "Nebel",
        48: "Reifnebel",
        51: "Leichter Nieselregen",
        53: "Nieselregen",
        55: "Starker Nieselregen",
        61: "Leichter Regen",
        63: "Regen",
        65: "Starker Regen",
        71: "Leichter Schneefall",
        73: "Schneefall",
        75: "Starker Schneefall",
        80: "Regenschauer",
        81: "Starke Regenschauer",
        82: "Sehr starke Regenschauer",
        95: "Gewitter"
    }

    if (code === undefined) return "n/a"
    return map[code] ?? `Code ${code}`
}

function weatherCodeToEmoji(code: number | undefined) {
    if (code === undefined) return "?"

    if (code === 0 || code === 1) return "sun"
    if (code === 2 || code === 3) return "cloud"
    if (code === 45 || code === 48) return "fog"
    if (code === 51 || code === 53 || code === 55) return "drizzle"
    if (code === 61 || code === 63 || code === 65) return "rain"
    if (code === 71 || code === 73 || code === 75) return "snow"
    if (code === 80 || code === 81 || code === 82) return "showers"
    if (code === 95) return "thunder"

    return "weather"
}

async function resolveLocation(location?: string) {
    const input = location?.trim()
    if (!input) return DEFAULT_LOCATION

    const params = new URLSearchParams({
        name: input,
        count: "1",
        language: "de",
        format: "json"
    })

    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`)
    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "weather",
            "GEOCODING_REQUEST_FAILED",
            "Ort konnte nicht aufgeloest werden.",
            502,
            `Geocoding error (${response.status}): ${details}`
        )
    }

    const data = (await response.json()) as GeocodingResponse
    const result = data.results?.[0]
    if (!result || result.latitude === undefined || result.longitude === undefined || !result.name) {
        throw new UserError("LOCATION_NOT_FOUND", `Ort nicht gefunden: ${input}`)
    }

    const label = result.country ? `${result.name}, ${result.country}` : result.name
    return { label, latitude: result.latitude, longitude: result.longitude }
}

function weatherLocationKey(telegramUserId: string) {
    return `${WEATHER_LOCATION_KEY_PREFIX}${telegramUserId}`
}

export async function rememberWeatherLocation(telegramUserId: string, location: string) {
    const trimmed = location.trim()
    if (!trimmed) return

    await ensureStateConnected()
    await state.set(weatherLocationKey(telegramUserId), trimmed)
}

export async function getRememberedWeatherLocation(telegramUserId: string) {
    await ensureStateConnected()
    return (await state.get<string>(weatherLocationKey(telegramUserId))) ?? undefined
}

export async function getWeather(location: string | undefined, dayOffset: 0 | 1): Promise<WeatherSummary> {
    const resolved = await resolveLocation(location)
    const forecastDays = dayOffset + 1

    const params = new URLSearchParams({
        latitude: String(resolved.latitude),
        longitude: String(resolved.longitude),
        current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        daily: "temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code",
        timezone: "Europe/Berlin",
        forecast_days: String(forecastDays)
    })

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
    if (!response.ok) {
        const details = await response.text()
        throw new ProviderError(
            "weather",
            "WEATHER_API_REQUEST_FAILED",
            "Wetterdaten konnten nicht geladen werden.",
            502,
            `Weather API error (${response.status}): ${details}`
        )
    }

    const data = (await response.json()) as OpenMeteoResponse
    const current = data.current ?? {}
    const daily = data.daily ?? {}
    const index = dayOffset
    const dailyWeatherCode = daily.weather_code?.[index]

    return {
        locationLabel: resolved.label,
        condition: weatherCodeToText(dayOffset === 0 ? current.weather_code : dailyWeatherCode),
        conditionEmoji: weatherCodeToEmoji(dayOffset === 0 ? current.weather_code : dailyWeatherCode),
        temperatureC: dayOffset === 0 ? current.temperature_2m : undefined,
        apparentTemperatureC: dayOffset === 0 ? current.apparent_temperature : undefined,
        windSpeedKmh: dayOffset === 0 ? current.wind_speed_10m : undefined,
        minTempC: daily.temperature_2m_min?.[index],
        maxTempC: daily.temperature_2m_max?.[index],
        precipitationProbabilityPct: daily.precipitation_probability_max?.[index]
    }
}
