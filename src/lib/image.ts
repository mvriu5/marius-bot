import { openai } from "@ai-sdk/openai"
import { generateImage } from "ai"
import { ProviderError } from "../errors/appError.js"

export type GeneratedImage = {
    data: Buffer
    mimeType: string
    filename: string
}

export async function generateAiImage(prompt: string): Promise<GeneratedImage> {
    const result = await generateImage({
        model: openai.image("dall-e-3"),
        prompt,
        size: "1024x1024"
    })

    const image = result.image
    if (!image) {
        throw new ProviderError(
            "openai",
            "OPENAI_NO_IMAGE",
            "Bild konnte nicht erstellt werden.",
            502,
            "OpenAI lieferte kein Bild."
        )
    }

    const mimeType = image.mediaType ?? "image/png"
    const ext = mimeType.split("/")[1] ?? "png"
    return {
        data: Buffer.from(image.uint8Array),
        mimeType,
        filename: `image.${ext}`
    }
}
