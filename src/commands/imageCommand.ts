import { postThreadError } from "../errors/errorOutput.js"
import { generateAiImage } from "../lib/image.js"
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
            return { ok: false, message: "Bitte nutze /image <beschreibung>" }
        }
        return { ok: true, value: { prompt } }
    },
    execute: async (ctx) => {
        try {
            await ctx.thread.post("🎨 Bild wird erstellt...")
            const imageBuffer = await generateAiImage(ctx.parsedArgs.prompt)
            await ctx.thread.post({
                markdown: `🖼️ ${ctx.parsedArgs.prompt}`,
                files: [{ data: imageBuffer.data, filename: imageBuffer.filename, mimeType: imageBuffer.mimeType }]
            })
        } catch (error) {
            await postThreadError(ctx.thread, error, "Bild konnte nicht erstellt werden")
        }
    }
}

export const image = new Command(imageCommand)
