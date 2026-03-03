import { openai } from "@ai-sdk/openai"
import { type ModelMessage, stepCountIs, ToolLoopAgent } from "ai"
import { emoji } from "chat"
import { ProviderError } from "../errors/appError.js"

export type AgentAnswer = {
    text: string
    reactionName?: string
}

function parseAgentOutput(raw: string): AgentAnswer {
    const reactionMatch = raw.match(/\[reaction:([a-z0-9_]+)\]/i)
    const reactionName = reactionMatch?.[1]?.toLowerCase()
    const text = raw.replace(/\[reaction:[^\]]+\]/gi, "").trim()
    return {
        text,
        reactionName
    }
}

export async function askAgent(question: string, history: ModelMessage[] = []): Promise<AgentAnswer> {
    const availableEmojiNames = Object.keys(emoji).join(", ")
    const agent = new ToolLoopAgent({
        model: openai("gpt-5-nano"),
        stopWhen: stepCountIs(20),
        instructions: [
            "Du bist ein hilfreicher Assistent. Antworte klar und knapp auf Deutsch.",
            "Nutze wenn sinnvoll Emojis aus dem Chat SDK als Token im Format :emoji_name:.",
            `Verfügbare Emoji-Namen: ${availableEmojiNames}.`,
            "Wenn eine Reaction zur letzten User-Nachricht hilfreich ist, füge genau ein Token [reaction:emoji_name] hinzu.",
            "Wenn keine Reaction sinnvoll ist, füge kein Reaction-Token hinzu."
        ].join(" "),
        tools: {}
    })

    const messages: ModelMessage[] = [
        ...history,
        { role: "user", content: question }
    ]

    const result = await agent.generate({ messages })

    const rawAnswer = result.text?.trim()
    if (!rawAnswer) {
        throw new ProviderError(
            "openai",
            "OPENAI_EMPTY_RESPONSE",
            "Agent konnte keine Antwort erzeugen.",
            502,
            "OpenAI lieferte keine Antwort."
        )
    }

    const parsed = parseAgentOutput(rawAnswer)
    if (!parsed.text) {
        return {
            text: "",
            reactionName: parsed.reactionName
        }
    }

    return parsed
}
