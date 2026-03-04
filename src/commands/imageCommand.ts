import { openai } from "@ai-sdk/openai"
import { generateImage } from "ai"
import { postThreadError } from "../errors/errorOutput.js"
import { Command, type CommandDefinition } from "../types/command.js"

type ImageParsedArgs = {
    prompt: string
}

const imageCommand: CommandDefinition<"image", ImageParsedArgs> = {
    name: "image",
    argPolicy: { type: "any" },
    parseArgs: (args) => {
        const prompt = args.join(" ").trim()
        if (!prompt) {
            return { ok: false, message: "Bitte gib eine Beschreibung für das Bild an." }
        }
        return { ok: true, value: { prompt } }
    },
    execute: async (ctx) => {
        try {
            await ctx.thread.startTyping()

            const result = await generateImage({
                model: openai.image("dall-e-3"),
                prompt: ctx.parsedArgs.prompt
            })

            const imageBuffer = Buffer.from(result.image.base64, "base64")

            await ctx.thread.post({
                markdown: `🎨 ${ctx.parsedArgs.prompt}`,
                files: [{ data: imageBuffer, filename: "image.png", mimeType: "image/png" }]
            })
        } catch (error) {
            await postThreadError(ctx.thread, error, "Bild konnte nicht erstellt werden")
        }
    }
}

export const image = new Command(imageCommand)
