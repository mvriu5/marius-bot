type PlausibleMetrics = {
    visitors: number
    pageviews: number
    bounceRatePct: number | null
    visitDurationSec: number | null
}

export type PlausibleSiteAnalytics = {
    siteId: string
    label: string
    metrics: PlausibleMetrics
}

export type PlausibleAnalyticsSummary = {
    windowStartIso: string
    windowEndIso: string
    sites: PlausibleSiteAnalytics[]
    errors: string[]
}

type PlausibleSiteConfig = {
    siteId: string
    label: string
}


function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return null
}

function requirePlausibleConfig() {
    const apiKey = process.env.PLAUSIBLE_API_KEY?.trim()
    if (!apiKey) throw new Error("Missing PLAUSIBLE_API_KEY")

    const rawSiteIds = [process.env.PLAUSIBLE_SITE_IDS]
        .join(",")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)

    if (rawSiteIds.length === 0) {
        throw new Error("Missing PLAUSIBLE_SITE_IDS")
    }

    const seenSiteIds = new Set<string>()
    const sites: PlausibleSiteConfig[] = []

    for (const raw of rawSiteIds) {
        const [left, right] = raw.includes("=") ? raw.split("=", 2) : [raw, raw]
        const label = left.trim()
        const siteId = right.trim()

        if (!siteId) continue
        if (seenSiteIds.has(siteId)) continue
        seenSiteIds.add(siteId)

        sites.push({
            siteId,
            label: label || siteId
        })
    }

    const baseUrl = process.env.PLAUSIBLE_API_BASE_URL!.trim().replace(/\/+$/, "")
    return { apiKey, sites, baseUrl }
}

function parseV2Aggregate(data: unknown): PlausibleMetrics | null {
    if (!data || typeof data !== "object") return null
    const root = data as Record<string, unknown>

    const firstResult = Array.isArray(root.results) && root.results.length > 0
        ? root.results[0] as Record<string, unknown>
        : null

    if (firstResult && Array.isArray(firstResult.metrics)) {
        const [visitorsRaw, pageviewsRaw, bounceRateRaw, visitDurationRaw] = firstResult.metrics
        return {
            visitors: toNumber(visitorsRaw) ?? 0,
            pageviews: toNumber(pageviewsRaw) ?? 0,
            bounceRatePct: toNumber(bounceRateRaw),
            visitDurationSec: toNumber(visitDurationRaw)
        }
    }

    const metricsObject = firstResult?.metrics
    if (metricsObject && typeof metricsObject === "object") {
        const metrics = metricsObject as Record<string, unknown>
        return {
            visitors: toNumber(metrics.visitors) ?? 0,
            pageviews: toNumber(metrics.pageviews) ?? 0,
            bounceRatePct: toNumber(metrics.bounce_rate),
            visitDurationSec: toNumber(metrics.visit_duration)
        }
    }

    return null
}

function parseV1Aggregate(data: unknown): PlausibleMetrics | null {
    if (!data || typeof data !== "object") return null
    const root = data as Record<string, unknown>
    const results = root.results
    if (!results || typeof results !== "object") return null
    const obj = results as Record<string, unknown>

    const visitors = toNumber((obj.visitors as Record<string, unknown>)?.value ?? obj.visitors) ?? 0
    const pageviews = toNumber((obj.pageviews as Record<string, unknown>)?.value ?? obj.pageviews) ?? 0
    const bounceRatePct = toNumber((obj.bounce_rate as Record<string, unknown>)?.value ?? obj.bounce_rate)
    const visitDurationSec = toNumber((obj.visit_duration as Record<string, unknown>)?.value ?? obj.visit_duration)

    return { visitors, pageviews, bounceRatePct, visitDurationSec }
}

async function fetchV2Aggregate(
    baseUrl: string,
    apiKey: string,
    siteId: string,
    windowStartIso: string,
    windowEndIso: string
) {
    const response = await fetch(`${baseUrl}/api/v2/query`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            site_id: siteId,
            metrics: ["visitors", "pageviews", "bounce_rate", "visit_duration"],
            date_range: [windowStartIso, windowEndIso]
        })
    })

    if (!response.ok) {
        const details = await response.text()
        throw new Error(`Plausible v2 error (${response.status}): ${details}`)
    }

    return parseV2Aggregate(await response.json())
}

async function fetchV1Aggregate(baseUrl: string, apiKey: string, siteId: string, windowStartIso: string, windowEndIso: string) {
    const startDate = windowStartIso.slice(0, 10)
    const endDate = windowEndIso.slice(0, 10)

    const params = new URLSearchParams({
        site_id: siteId,
        period: "custom",
        date: `${startDate},${endDate}`,
        metrics: "visitors,pageviews,bounce_rate,visit_duration"
    })

    const response = await fetch(`${baseUrl}/api/v1/stats/aggregate?${params.toString()}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`
        }
    })

    if (!response.ok) {
        const details = await response.text()
        throw new Error(`Plausible v1 error (${response.status}): ${details}`)
    }

    return parseV1Aggregate(await response.json())
}

async function fetchSiteAnalytics(
    baseUrl: string,
    apiKey: string,
    site: PlausibleSiteConfig,
    windowStartIso: string,
    windowEndIso: string
): Promise<PlausibleSiteAnalytics> {
    const v2Metrics = await fetchV2Aggregate(baseUrl, apiKey, site.siteId, windowStartIso, windowEndIso).catch(() => null)

    const metrics = v2Metrics ?? await fetchV1Aggregate(baseUrl, apiKey, site.siteId, windowStartIso, windowEndIso)

    if (!metrics) {
        throw new Error(`Plausible response could not be parsed for ${site.siteId}`)
    }

    return {
        siteId: site.siteId,
        label: site.label,
        metrics
    }
}

export async function getPlausibleLast24HoursAnalytics(siteQuery?: string): Promise<PlausibleAnalyticsSummary> {
    const { apiKey, sites, baseUrl } = requirePlausibleConfig()

    const now = new Date()
    const before24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const windowStartIso = before24h.toISOString()
    const windowEndIso = now.toISOString()

    const query = siteQuery?.trim().toLowerCase()
    const selectedSites = query
        ? sites.filter((site) => site.siteId.toLowerCase().includes(query) || site.label.toLowerCase().includes(query))
        : sites

    if (selectedSites.length === 0) {
        throw new Error(`No Plausible site matched query: ${siteQuery}`)
    }

    const results = await Promise.allSettled(selectedSites.map((site) =>
        fetchSiteAnalytics(baseUrl, apiKey, site, windowStartIso, windowEndIso))
    )

    const analytics: PlausibleSiteAnalytics[] = []
    const errors: string[] = []

    for (const result of results) {
        if (result.status === "fulfilled") {
            analytics.push(result.value)
        } else {
            errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
    }

    if (analytics.length === 0) {
        throw new Error(`Plausible analytics failed: ${errors.join("; ")}`)
    }

    return {
        windowStartIso,
        windowEndIso,
        sites: analytics,
        errors
    }
}
