import { openai } from "@ai-sdk/openai"
import { type ModelMessage, stepCountIs, ToolLoopAgent } from "ai"

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
