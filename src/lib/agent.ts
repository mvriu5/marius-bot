import { openai } from "@ai-sdk/openai"
import { type ModelMessage, stepCountIs, ToolLoopAgent } from "ai"

type ChoiceButton = {
    label: string
    value: string
}

const TELEGRAM_CALLBACK_DATA_LIMIT = 64

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim()
}

function sanitizeChoiceValue(value: string): string {
    return normalizeWhitespace(value)
        .replace(/^["'`(\[]+/, "")
        .replace(/["'`)\].,!?;:]+$/, "")
        .trim()
}

function toChoice(label: string): ChoiceButton | null {
    const normalizedLabel = normalizeWhitespace(label)
    const normalizedValue = sanitizeChoiceValue(label).toLowerCase()
    if (!normalizedLabel || !normalizedValue) return null

    const callbackValue = `agent ${normalizedValue}`
    if (Buffer.byteLength(callbackValue, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT) return null

    return {
        label: normalizedLabel,
        value: callbackValue
    }
}

export function extractTwoChoices(text: string): [ChoiceButton, ChoiceButton] | null {
    const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)

    for (const line of lines) {
        const yesNoMatch = line.match(/\b(ja|yes)\b\s*(?:\/|oder|or)\s*\b(nein|no)\b/i)
        if (yesNoMatch) {
            const left = toChoice("Ja")
            const right = toChoice("Nein")
            if (left && right) return [left, right]
        }

        if (!line.includes("?")) continue

        const slashMatch = line.match(/(.+?)\s*\/\s*(.+?)(?:[?.!]|$)/)
        if (slashMatch) {
            const left = toChoice(slashMatch[1] ?? "")
            const right = toChoice(slashMatch[2] ?? "")
            if (left && right) return [left, right]
        }

        const oderMatch = line.match(/(.+?)\s+(?:oder|or)\s+(.+?)(?:[?.!]|$)/i)
        if (oderMatch) {
            const left = toChoice(oderMatch[1] ?? "")
            const right = toChoice(oderMatch[2] ?? "")
            if (left && right) return [left, right]
        }
    }

    return null
}

export async function askAgent(question: string, history: ModelMessage[] = []) {
    const agent = new ToolLoopAgent({
        model: openai("gpt-5-nano"),
        stopWhen: stepCountIs(20),
        instructions: "Du bist ein hilfreicher Assistent. Antworte klar und knapp auf Deutsch.",
        tools: {}
    })

    const messages: ModelMessage[] = [
        ...history,
        { role: "user", content: question }
    ]

    const result = await agent.generate({ messages })

    const answer = result.text?.trim()
    if (!answer) throw new Error("OpenAI lieferte keine Antwort.")
    return answer
}
