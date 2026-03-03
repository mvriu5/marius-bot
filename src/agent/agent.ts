import { openai } from "@ai-sdk/openai"
import { type ModelMessage, stepCountIs, ToolLoopAgent } from "ai"
import { ProviderError } from "../errors/appError.js"

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
    if (!answer) {
        throw new ProviderError(
            "openai",
            "OPENAI_EMPTY_RESPONSE",
            "Agent konnte keine Antwort erzeugen.",
            502,
            "OpenAI lieferte keine Antwort."
        )
    }
    return answer
}
