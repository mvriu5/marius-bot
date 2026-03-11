import { normalizeError } from "../../errors/appError.js"
import { logError, postThreadError } from "../../errors/errorOutput.js"
import {
    closePullRequest,
    createGithubAuthorizationUrl,
    GithubAuthorizationRequiredError,
    isGithubConnected,
    listGithubWritableRepositories,
    mergePullRequest
} from "../../integrations/github.js"
import {
    type CopilotTask,
    createCopilotPendingPrompt,
    createCopilotRepoSelection,
    deleteCopilotPendingPrompt,
    deleteCopilotRepoSelection,
    getCopilotPendingPrompt,
    getCopilotRepoSelection,
    getCopilotTask,
    setCopilotTask,
    startCopilotTaskFromPending
} from "../../lib/copilotTasks.js"
import { clearCopilotPinnedMessages, transitionCopilotPinnedMessage } from "../../lib/copilotPins.js"
import { type ParsedCommandContext } from "../../types/command.js"
import { ACTION_IDS } from "../shared/actionIds.js"
import { postOAuthLoginCard } from "../../ui/oauthCards.js"
import {
    createCloseSuccessCard,
    createMergeSuccessCard,
    createRepoSelectionCard,
    createStartedCard
} from "./cards.js"
import { type CopilotParsedArgs } from "./types.js"

type CopilotCommandContext = ParsedCommandContext<"copilot", CopilotParsedArgs>

async function deleteTrackedPrCards(task: CopilotTask, actionMessageId?: string) {
    const ids = new Set([
        ...(task.prCardMessageIds ?? []),
        ...(task.repoSelectionMessageId ? [task.repoSelectionMessageId] : []),
        ...(task.startedMessageId ? [task.startedMessageId] : [])
    ])
    if (actionMessageId) ids.add(actionMessageId)
    if (ids.size === 0) return

    const { bot } = await import("../../server/bot.js")
    const adapter = bot.getAdapter("telegram")
    for (const id of ids) {
        try {
            await adapter.deleteMessage(task.threadId, id)
        } catch {
            // ignore cards that are already deleted or cannot be removed
        }
    }
}

async function postGithubLogin(
    ctx: CopilotCommandContext,
    userId: string,
    text: string
) {
    const url = await createGithubAuthorizationUrl(userId)
    await postOAuthLoginCard(ctx.thread, {
        title: "GitHub Login",
        text,
        authorizationUrl: url
    })
}

export async function executeCopilot(ctx: CopilotCommandContext) {
    const parsed = ctx.parsedArgs
    const userId = ctx.message.author.userId
    let activeTask: CopilotTask | undefined

    if (parsed.action === "login") {
        try {
            await postGithubLogin(ctx, userId, "Bitte verbinde GitHub hier:")
        } catch (error) {
            await postThreadError(ctx.thread, error, "GitHub Login konnte nicht gestartet werden")
        }
        return
    }

    try {
        if (parsed.action === "start") {
            if (!parsed.prompt.trim()) {
                await ctx.thread.post("Bitte nutze /copilot <text>.")
                return
            }

            const connected = await isGithubConnected(userId)
            if (!connected) {
                await postGithubLogin(ctx, userId, "Bitte verbinde zuerst GitHub:")
                return
            }

            const pending = await createCopilotPendingPrompt({
                threadId: ctx.thread.id,
                userId,
                prompt: parsed.prompt
            })

            const repos = await listGithubWritableRepositories(userId)
            if (repos.length === 0) {
                await ctx.thread.post("Keine beschreibbaren Repositories gefunden.")
                return
            }

            const repoButtons = await Promise.all(
                repos.map(async (repo) => {
                    const selection = await createCopilotRepoSelection({
                        pendingId: pending.id,
                        threadId: ctx.thread.id,
                        userId,
                        repoFullName: repo.fullName
                    })

                    return {
                        id: ACTION_IDS.copilot.repo,
                        label: repo.name,
                        value: selection.id
                    }
                })
            )

            await ctx.thread.post(createRepoSelectionCard(parsed.prompt, repoButtons))
            return
        }

        if (parsed.action === "repo") {
            const selection = await getCopilotRepoSelection(parsed.selectionId)
            if (!selection || selection.userId !== userId || selection.threadId !== ctx.thread.id) {
                await ctx.thread.post("Die Repository-Auswahl ist abgelaufen. Bitte starte /copilot erneut.")
                return
            }

            const pending = await getCopilotPendingPrompt(selection.pendingId)
            if (!pending || pending.userId !== userId || pending.threadId !== ctx.thread.id) {
                await ctx.thread.post("Die Copilot-Auswahl ist abgelaufen. Bitte starte /copilot erneut.")
                return
            }

            const task = await startCopilotTaskFromPending({
                pending,
                repoFullName: selection.repoFullName
            })
            activeTask = task

            await deleteCopilotPendingPrompt(selection.pendingId)
            await deleteCopilotRepoSelection(selection.id)

            const startedCard = await ctx.thread.post(
                createStartedCard(task.repoFullName, task.issueUrl)
            )
            await transitionCopilotPinnedMessage({
                threadId: task.threadId,
                nextPinnedMessageId: startedCard.id
            })
            await setCopilotTask({
                ...task,
                repoSelectionMessageId: ctx.source === "action" ? ctx.actionMessageId : undefined,
                startedMessageId: startedCard.id,
                finalPinnedMessageId: undefined
            })
            return
        }

        const task = await getCopilotTask(parsed.taskId)
        if (!task || task.userId !== userId || task.threadId !== ctx.thread.id) {
            await ctx.thread.post("Copilot-Task nicht gefunden.")
            return
        }
        activeTask = task

        if (parsed.action === "later") {
            await clearCopilotPinnedMessages({
                threadId: task.threadId,
                processingMessageId: task.startedMessageId,
                currentPinnedMessageId: task.finalPinnedMessageId
            })
            await setCopilotTask({
                ...task,
                finalPinnedMessageId: undefined
            })
            await ctx.thread.post("Okay, ich lasse den PR unverändert.")
            return
        }

        if (!task.prNumber) {
            await ctx.thread.post("Der PR ist noch nicht verfügbar.")
            return
        }

        if (parsed.action === "merge") {
            await mergePullRequest(userId, task.repoFullName, task.prNumber)
            const actionMessageId = ctx.source === "action" ? ctx.actionMessageId : undefined
            await clearCopilotPinnedMessages({
                threadId: task.threadId,
                processingMessageId: task.startedMessageId,
                currentPinnedMessageId: task.finalPinnedMessageId
            })
            await deleteTrackedPrCards(task, actionMessageId)
            await setCopilotTask({
                ...task,
                status: "merged",
                prCardMessageIds: [],
                repoSelectionMessageId: undefined,
                startedMessageId: undefined,
                finalPinnedMessageId: undefined
            })
            await ctx.thread.post(createMergeSuccessCard(task.prNumber, task.prUrl))
            return
        }

        await closePullRequest(userId, task.repoFullName, task.prNumber)
        const actionMessageId = ctx.source === "action" ? ctx.actionMessageId : undefined
        await clearCopilotPinnedMessages({
            threadId: task.threadId,
            processingMessageId: task.startedMessageId,
            currentPinnedMessageId: task.finalPinnedMessageId
        })
        await deleteTrackedPrCards(task, actionMessageId)
        await setCopilotTask({
            ...task,
            status: "rejected",
            prCardMessageIds: [],
            repoSelectionMessageId: undefined,
            startedMessageId: undefined,
            finalPinnedMessageId: undefined
        })
        await ctx.thread.post(createCloseSuccessCard(task.prUrl))
    } catch (error) {
        if (error instanceof GithubAuthorizationRequiredError) {
            await postGithubLogin(ctx, userId, "Bitte verbinde zuerst GitHub:")
            return
        }

        const normalized = normalizeError(error)
        logError("/copilot fehlgeschlagen", error)
        const errorMessage = await ctx.thread.post(`⚠️ /copilot fehlgeschlagen: ${normalized.userMessage}`)

        if (activeTask) {
            await transitionCopilotPinnedMessage({
                threadId: activeTask.threadId,
                processingMessageId: activeTask.startedMessageId,
                currentPinnedMessageId: activeTask.finalPinnedMessageId,
                nextPinnedMessageId: errorMessage.id
            })
            await setCopilotTask({
                ...activeTask,
                finalPinnedMessageId: errorMessage.id
            })
        }
    }
}
