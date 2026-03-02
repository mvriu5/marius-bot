import { openai } from "@ai-sdk/openai"
import { stepCountIs, ToolLoopAgent } from "ai"

export async function askAgent(question: string) {
    const agent = new ToolLoopAgent({
        model: openai("gpt-5-mini"),
        stopWhen: stepCountIs(20),
        instructions: "Du bist ein hilfreicher Assistent. Antworte klar und knapp auf Deutsch.",
        tools: {}
    })

    const result = await agent.generate({
        prompt: question
    })

    const answer = result.text?.trim()
    if (!answer) throw new Error("OpenAI lieferte keine Antwort.")
    return answer
}
