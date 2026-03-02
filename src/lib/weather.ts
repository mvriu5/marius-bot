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
    }
}

import { ensureStateConnected, state } from "../types/state.js"

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

export type WeatherSummary = {
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
        1: "Überwiegend klar",
        2: "Teilweise bewölkt",
        3: "Bewölkt",
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
    if (code === undefined) return "❓"

    if (code === 0 || code === 1) return "☀️"
    if (code === 2 || code === 3) return "⛅"
    if (code === 45 || code === 48) return "🌫️"
    if (code === 51 || code === 53 || code === 55) return "🌦️"
    if (code === 61 || code === 63 || code === 65) return "🌧️"
    if (code === 71 || code === 73 || code === 75) return "🌨️"
    if (code === 80 || code === 81 || code === 82) return "🌦️"
    if (code === 95) return "⛈️"

    return "🌡️"
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
        throw new Error(`Geocoding error (${response.status}): ${details}`)
    }

    const data = (await response.json()) as GeocodingResponse
    const result = data.results?.[0]
    if (!result || result.latitude === undefined || result.longitude === undefined || !result.name) {
        throw new Error(`Ort nicht gefunden: ${input}`)
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

export async function getTodayWeather(location?: string): Promise<WeatherSummary> {
    const resolved = await resolveLocation(location)

    const params = new URLSearchParams({
        latitude: String(resolved.latitude),
        longitude: String(resolved.longitude),
        current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        daily: "temperature_2m_min,temperature_2m_max,precipitation_probability_max",
        timezone: "Europe/Berlin",
        forecast_days: "1"
    })

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
    if (!response.ok) {
        const details = await response.text()
        throw new Error(`Weather API error (${response.status}): ${details}`)
    }

    const data = (await response.json()) as OpenMeteoResponse
    const current = data.current ?? {}
    const daily = data.daily ?? {}

    return {
        locationLabel: resolved.label,
        condition: weatherCodeToText(current.weather_code),
        conditionEmoji: weatherCodeToEmoji(current.weather_code),
        temperatureC: current.temperature_2m,
        apparentTemperatureC: current.apparent_temperature,
        windSpeedKmh: current.wind_speed_10m,
        minTempC: daily.temperature_2m_min?.[0],
        maxTempC: daily.temperature_2m_max?.[0],
        precipitationProbabilityPct: daily.precipitation_probability_max?.[0]
    }
}
