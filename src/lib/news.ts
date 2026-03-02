type NewsCategory = "Politik" | "Welt" | "AI/Tech"

type NewsItem = {
    category: NewsCategory
    title: string
    link: string
    publishedAt: number
}

type NewsSummary = {
    errors: string[]
    items: NewsItem[]
}

const RSS_SOURCES: Array<{ category: NewsCategory; url: string }> = [
    { category: "Politik", url: "https://feeds.bbci.co.uk/news/politics/rss.xml" },
    { category: "Welt", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { category: "AI/Tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
    { category: "AI/Tech", url: "https://news.google.com/rss/search?q=artificial+intelligence+when:1d&hl=en-US&gl=US&ceid=US:en" }
]

function decodeXml(value: string) {
    return value
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .trim()
}

function extractTag(itemXml: string, tag: string) {
    const match = itemXml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))
    return match ? decodeXml(match[1]) : ""
}

function parseRssItems(xml: string, category: NewsCategory): NewsItem[] {
    const matches = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
    const items: NewsItem[] = []

    for (const itemXml of matches) {
        const title = extractTag(itemXml, "title")
        const link = extractTag(itemXml, "link")
        const pubDate = extractTag(itemXml, "pubDate")
        const publishedAt = pubDate ? Date.parse(pubDate) : 0

        if (!title || !link) continue

        items.push({
            category,
            title,
            link,
            publishedAt: Number.isNaN(publishedAt) ? 0 : publishedAt
        })
    }

    return items
}

function dedupeByTitle(items: NewsItem[]) {
    const seen = new Set<string>()
    const deduped: NewsItem[] = []

    for (const item of items) {
        const key = item.title.toLowerCase().replace(/\s+/g, " ").trim()
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(item)
    }

    return deduped
}

export async function getTodayNews(limit = 8): Promise<NewsSummary> {
    const clampedLimit = Math.max(5, Math.min(10, limit))

    const results = await Promise.allSettled(
        RSS_SOURCES.map(async (source) => {
            const response = await fetch(source.url)
            if (!response.ok) {
                throw new Error(`${source.category} feed failed (${response.status})`)
            }
            const xml = await response.text()
            return parseRssItems(xml, source.category)
        })
    )

    const errors: string[] = []
    const allItems: NewsItem[] = []

    for (const result of results) {
        if (result.status === "fulfilled") {
            allItems.push(...result.value)
        } else {
            errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
    }

    const topItems = dedupeByTitle(allItems)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, clampedLimit)

    if (topItems.length === 0) {
        throw new Error(`Keine News gefunden${errors.length ? ` (${errors.join("; ")})` : ""}`)
    }

    return {
        items: topItems,
        errors
    }
}
