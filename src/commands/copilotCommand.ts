import { Actions, Button, Card, CardLink, CardText, LinkButton } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import {
    closePullRequest,
    createGithubAuthorizationUrl,
    GithubAuthorizationRequiredError,
    isGithubConnected,
    listGithubWritableRepositories,
    mergePullRequest
} from "../lib/github.js"
import {
    createCopilotPendingPrompt,
    deleteCopilotPendingPrompt,
    getCopilotPendingPrompt,
    getCopilotTask,
    setCopilotTask,
    startCopilotTaskFromPending
} from "../lib/copilotTasks.js"
import { Command, type CommandDefinition } from "../types/command.js"

type CopilotAction = "start" | "repo" | "login" | "merge" | "reject" | "later"

type CopilotParsedArgs =
    | { action: "start"; prompt: string }
    | { action: "repo"; pendingId: string; repoFullName: string }
    | { action: "login" }
    | { action: "merge"; taskId: string }
    | { action: "reject"; taskId: string }
    | { action: "later"; taskId: string }

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
            const pendingId = args[1]
            const repoFullName = args[2]
            if (!pendingId || !repoFullName) {
                return { ok: false, message: "Nutze /copilot repo <pendingId> <owner/repo>" }
            }
            return { ok: true, value: { action: "repo", pendingId, repoFullName } }
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

                await ctx.thread.post(
                    Card({
                        title: "Copilot: Repository auswählen",
                        children: [
                            CardText(`Prompt: ${parsed.prompt.slice(0, 250)}`),
                            CardText("Wähle ein Repository:"),
                            Actions(
                                repos.map((repo) =>
                                    Button({
                                        id: "command:copilot:repo",
                                        label: repo.fullName,
                                        value: `copilot repo ${pending.id} ${repo.fullName}`
                                    })
                                )
                            )
                        ]
                    })
                )
                return
            }

            if (parsed.action === "repo") {
                const pending = await getCopilotPendingPrompt(parsed.pendingId)
                if (!pending || pending.userId !== userId || pending.threadId !== ctx.thread.id) {
                    await ctx.thread.post("Die Copilot-Auswahl ist abgelaufen. Bitte starte /copilot erneut.")
                    return
                }

                const task = await startCopilotTaskFromPending({
                    pending,
                    repoFullName: parsed.repoFullName
                })
                await deleteCopilotPendingPrompt(parsed.pendingId)

                await ctx.thread.post(
                    Card({
                        title: "Copilot arbeitet",
                        children: [
                            CardText(`Repo: ${task.repoFullName}`),
                            CardText(`Prompt: ${task.prompt.slice(0, 250)}`),
                            CardText(`Issue #${task.issueNumber} wurde Copilot zugewiesen.`),
                            CardLink({ url: task.issueUrl, label: "Issue öffnen" }),
                            CardText("Ich sende dir automatisch den PR mit Merge/Ablehnen/Später-Buttons.")
                        ]
                    })
                )
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
                await setCopilotTask({ ...task, status: "merged" })
                await ctx.thread.post(`PR wurde gemerged: ${task.prUrl ?? `#${task.prNumber}`}`)
                return
            }

            await closePullRequest(userId, task.repoFullName, task.prNumber)
            await setCopilotTask({ ...task, status: "rejected" })
            await ctx.thread.post(`PR wurde geschlossen: ${task.prUrl ?? `#${task.prNumber}`}`)
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
