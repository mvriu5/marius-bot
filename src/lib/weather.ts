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

// Hardcoded location: Berlin
const LATITUDE = 52.52
const LONGITUDE = 13.41
const LOCATION_LABEL = "Berlin"

function weatherCodeToText(code: number | undefined) {
    const map: Record<number, string> = {
        0: "Klar",
        1: "Ueberwiegend klar",
        2: "Teilweise bewolkt",
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

function formatTemp(value: number | undefined) {
    if (value === undefined || Number.isNaN(value)) return "n/a"
    return `${value.toFixed(1)}°C`
}

export async function getWeatherSummaryMessage() {
    const params = new URLSearchParams({
        latitude: String(LATITUDE),
        longitude: String(LONGITUDE),
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

    return [
        `Wetter (${LOCATION_LABEL}):`,
        `- Zustand: ${weatherCodeToText(current.weather_code)}`,
        `- Jetzt: ${formatTemp(current.temperature_2m)} (gefuehlt ${formatTemp(current.apparent_temperature)})`,
        `- Wind: ${current.wind_speed_10m ?? "n/a"} km/h`,
        `- Heute min/max: ${formatTemp(daily.temperature_2m_min?.[0])} / ${formatTemp(daily.temperature_2m_max?.[0])}`,
        `- Regenwahrscheinlichkeit: ${daily.precipitation_probability_max?.[0] ?? "n/a"} %`
    ].join("\n")
}
