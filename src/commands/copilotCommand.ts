import { Actions, Card, CardLink, CardText, LinkButton } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import { ButtonGrid } from "../components/buttonGrid.js"
import {
    closePullRequest,
    createGithubAuthorizationUrl,
    GithubAuthorizationRequiredError,
    isGithubConnected,
    listGithubWritableRepositories,
    mergePullRequest
} from "../lib/github.js"
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
} from "../lib/copilotTasks.js"
import { Command, type CommandDefinition } from "../types/command.js"

type CopilotAction = "start" | "repo" | "login" | "merge" | "reject" | "later"

type CopilotParsedArgs =
    | { action: "start"; prompt: string }
    | { action: "repo"; selectionId: string }
    | { action: "login" }
    | { action: "merge"; taskId: string }
    | { action: "reject"; taskId: string }
    | { action: "later"; taskId: string }

async function deleteTrackedPrCards(task: CopilotTask, actionMessageId?: string) {
    const ids = new Set([
        ...(task.prCardMessageIds ?? []),
        ...(task.repoSelectionMessageId ? [task.repoSelectionMessageId] : []),
        ...(task.startedMessageId ? [task.startedMessageId] : [])
    ])
    if (actionMessageId) ids.add(actionMessageId)
    if (ids.size === 0) return

    const { bot } = await import("../server/bot.js")
    const adapter = bot.getAdapter("telegram")
    for (const id of ids) {
        try {
            await adapter.deleteMessage(task.threadId, id)
        } catch {
            // ignore cards that are already deleted or cannot be removed
        }
    }
}

const copilotCommand: CommandDefinition<"copilot", CopilotParsedArgs> = {
    name: "copilot",
    argPolicy: { type: "any" },
    parseArgs: (args) => {
        if (args.length === 0) {
            return { ok: false, message: "Bitte nutze /copilot <text>" }
        }

        const action = args[0]?.toLowerCase()
        if (action === "login") return { ok: true, value: { action: "login" } }

        if (action === "repo") {
            const selectionId = args[1]
            if (!selectionId) {
                return { ok: false, message: "Nutze /copilot repo <selectionId>" }
            }
            return { ok: true, value: { action: "repo", selectionId } }
        }

        if (action === "merge" || action === "reject" || action === "later") {
            const taskId = args[1]
            if (!taskId) {
                return { ok: false, message: `Nutze /copilot ${action} <taskId>` }
            }
            return { ok: true, value: { action, taskId } }
        }

        return {
            ok: true,
            value: {
                action: "start",
                prompt: args.join(" ").trim()
            }
        }
    },
    execute: async (ctx) => {
        const parsed = ctx.parsedArgs
        const userId = ctx.message.author.userId

        if (parsed.action === "login") {
            try {
                const url = await createGithubAuthorizationUrl(userId)
                await ctx.thread.post(
                    Card({
                        title: "GitHub Login",
                        children: [
                            CardText("Bitte verbinde GitHub hier:"),
                            Actions([LinkButton({ url, label: "Login" })])
                        ]
                    })
                )
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
                    const url = await createGithubAuthorizationUrl(userId)
                    await ctx.thread.post(
                        Card({
                            title: "GitHub Login",
                            children: [
                                CardText("Bitte verbinde zuerst GitHub:"),
                                Actions([LinkButton({ url, label: "Login" })])
                            ]
                        })
                    )
                    return
                }

                const pending = await createCopilotPendingPrompt({
                    threadId: ctx.thread.id,
                    userId,
                    prompt: parsed.prompt
                })

                const repos = await listGithubWritableRepositories(userId, 8)
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
                            id: "c:copilot:repo",
                            label: repo.fullName,
                            value: selection.id
                        }
                    })
                )

                await ctx.thread.post(
                    Card({
                        title: "Copilot: Repository auswählen",
                        children: [
                            CardText(`Prompt: ${parsed.prompt.slice(0, 250)}`),
                            CardText("Wähle ein Repository:"),
                            ...ButtonGrid({
                                buttons: repoButtons,
                                columns: 1
                            })
                        ]
                    })
                )
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

                await deleteCopilotPendingPrompt(selection.pendingId)
                await deleteCopilotRepoSelection(selection.id)

                const startedCard = await ctx.thread.post(
                    Card({
                        title: "Copilot arbeitet",
                        children: [
                            CardText(`Repo: ${task.repoFullName}`),
                            CardText("Ich schreibe dir sobald ich fertig bin."),
                            Actions([
                                LinkButton({ url: task.issueUrl, label: "Öffnen" })
                            ])
                        ]
                    })
                )
                await setCopilotTask({
                    ...task,
                    repoSelectionMessageId: ctx.source === "action" ? ctx.actionMessageId : undefined,
                    startedMessageId: startedCard.id
                })
                return
            }

            const task = await getCopilotTask(parsed.taskId)
            if (!task || task.userId !== userId || task.threadId !== ctx.thread.id) {
                await ctx.thread.post("Copilot-Task nicht gefunden.")
                return
            }

            if (parsed.action === "later") {
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
                await deleteTrackedPrCards(task, actionMessageId)
                await setCopilotTask({
                    ...task,
                    status: "merged",
                    prCardMessageIds: [],
                    repoSelectionMessageId: undefined,
                    startedMessageId: undefined
                })
                await ctx.thread.post(
                    Card({
                        title: `PR #${task.prNumber} wurde erfolgreich gemerged.`,
                        children: [
                            ...(task.prUrl
                                ? [Actions([LinkButton({ url: task.prUrl, label: "Öffnen" })])]
                                : [])
                        ]
                    })
                )
                return
            }

            await closePullRequest(userId, task.repoFullName, task.prNumber)
            const actionMessageId = ctx.source === "action" ? ctx.actionMessageId : undefined
            await deleteTrackedPrCards(task, actionMessageId)
            await setCopilotTask({
                ...task,
                status: "rejected",
                prCardMessageIds: [],
                repoSelectionMessageId: undefined,
                startedMessageId: undefined
            })
            await ctx.thread.post(
                Card({
                    title: "PR wurde geschlossen.",
                    children: [
                        ...(task.prUrl
                            ? [Actions([LinkButton({ url: task.prUrl, label: "Öffnen" })])]
                            : [])
                    ]
                })
            )
        } catch (error) {
            if (error instanceof GithubAuthorizationRequiredError) {
                const url = await createGithubAuthorizationUrl(userId)
                await ctx.thread.post(
                    Card({
                        title: "GitHub Login",
                        children: [
                            CardText("Bitte verbinde zuerst GitHub:"),
                            Actions([LinkButton({ url, label: "Login" })])
                        ]
                    })
                )
                return
            }

            await postThreadError(ctx.thread, error, "/copilot fehlgeschlagen")
        }
    }
}

export const copilot = new Command(copilotCommand)
