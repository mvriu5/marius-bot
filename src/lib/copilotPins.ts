import { pinMessage, unpinMessage } from "./pinnedMessages.js"

type CopilotPinTransitionInput = {
    threadId: string
    processingMessageId?: string
    currentPinnedMessageId?: string
    nextPinnedMessageId?: string
}

function toTelegramMessageId(messageId?: string): number | undefined {
    if (!messageId) return undefined
    const value = Number(messageId)
    if (!Number.isInteger(value)) return undefined
    return value
}

export async function transitionCopilotPinnedMessage(input: CopilotPinTransitionInput): Promise<void> {
    const nextPinnedId = toTelegramMessageId(input.nextPinnedMessageId)
    const idsToUnpin = new Set<number>()

    const processingId = toTelegramMessageId(input.processingMessageId)
    if (processingId !== undefined && processingId !== nextPinnedId) {
        idsToUnpin.add(processingId)
    }

    const currentPinnedId = toTelegramMessageId(input.currentPinnedMessageId)
    if (currentPinnedId !== undefined && currentPinnedId !== nextPinnedId) {
        idsToUnpin.add(currentPinnedId)
    }

    for (const id of idsToUnpin) {
        try {
            await unpinMessage(input.threadId, id)
        } catch {
            // ignore missing pin state and Telegram race conditions
        }
    }

    if (nextPinnedId === undefined) return

    try {
        await pinMessage(input.threadId, nextPinnedId)
    } catch {
        // pinning is best effort and must not block Copilot flow
    }
}

export async function clearCopilotPinnedMessages(input: {
    threadId: string
    processingMessageId?: string
    currentPinnedMessageId?: string
}): Promise<void> {
    await transitionCopilotPinnedMessage({
        threadId: input.threadId,
        processingMessageId: input.processingMessageId,
        currentPinnedMessageId: input.currentPinnedMessageId
    })
}
