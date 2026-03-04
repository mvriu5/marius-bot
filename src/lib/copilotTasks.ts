import { Card, CardText } from "chat"
import { Client } from "@upstash/qstash"
import { ProviderError, UserError } from "../errors/appError.js"
import { ButtonGrid } from "../components/buttonGrid.js"
import { ensureStateConnected, state } from "../types/state.js"
import {
    createCopilotIssueTask,
    findCopilotPrForIssue
} from "./github.js"

const COPILOT_PENDING_KEY = "copilot:pending:"
const COPILOT_TASK_KEY = "copilot:task:"
const COPILOT_REPO_SELECTION_KEY = "copilot:repo-selection:"
const COPILOT_PENDING_TTL_MS = 15 * 60 * 1000
const COPILOT_POLL_DELAY_SECONDS = 45
const COPILOT_MAX_ATTEMPTS = 20
const COPILOT_REQUIRED_STABLE_POLLS = 5

function escapeTelegramMarkdown(value: string) {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/([_*\[\]()`])/g, "\\$1")
}

export type CopilotPendingPrompt = {
    id: string
    threadId: string
    userId: string
    prompt: string
    createdAt: number
}

export type CopilotTask = {
    id: string
    threadId: string
    userId: string
    repoFullName: string
    prompt: string
    issueNumber: number
    issueUrl: string
    attempts: number
    status: "waiting" | "ready" | "merged" | "rejected" | "timeout"
    createdAt: number
    prNumber?: number
    prUrl?: string
    prCardMessageIds?: string[]
    lastPrHeadSha?: string
    stablePolls?: number
}

export type CopilotRepoSelection = {
    id: string
    pendingId: string
    threadId: string
    userId: string
    repoFullName: string
    createdAt: number
}

type CopilotPollPayload = {
    taskId: string
}

function newCopilotId(kind: "p" | "r" | "t") {
    const ts = Date.now().toString(36)
    const rnd = Math.random().toString(36).slice(2, 8)
    return `${kind}${ts}${rnd}`
}

function pendingKey(id: string) {
    return `${COPILOT_PENDING_KEY}${id}`
}

function taskKey(id: string) {
    return `${COPILOT_TASK_KEY}${id}`
}

function repoSelectionKey(id: string) {
    return `${COPILOT_REPO_SELECTION_KEY}${id}`
}

function requireQstashConfig() {
    const honoUrl = process.env.HONO_URL?.trim()
    if (!honoUrl) {
        throw new ProviderError(
            "qstash",
            "HONO_URL_MISSING",
            "Copilot-Konfiguration ist unvollständig.",
            500,
            "Missing HONO_URL"
        )
    }

    const qstashToken = process.env.QSTASH_TOKEN?.trim()
    if (!qstashToken) {
        throw new ProviderError(
            "qstash",
            "QSTASH_TOKEN_MISSING",
            "Copilot-Konfiguration ist unvollständig.",
            500,
            "Missing QSTASH_TOKEN"
        )
    }

    const qstashUrl = process.env.QSTASH_URL?.trim()
    return {
        callbackUrl: `${honoUrl.replace(/\/+$/, "")}/api/qstash/copilot`,
        qstashToken,
        qstashUrl
    }
}

export async function createCopilotPendingPrompt(input: {
    threadId: string
    userId: string
    prompt: string
}) {
    const prompt = input.prompt.trim()
    if (!prompt) {
        throw new UserError("COPILOT_PROMPT_EMPTY", "Bitte gib einen Prompt für /copilot an.")
    }

    const pending: CopilotPendingPrompt = {
        id: newCopilotId("p"),
        threadId: input.threadId,
        userId: input.userId,
        prompt,
        createdAt: Date.now()
    }

    await ensureStateConnected()
    await state.set(pendingKey(pending.id), pending, COPILOT_PENDING_TTL_MS)
    return pending
}

export async function getCopilotPendingPrompt(id: string) {
    await ensureStateConnected()
    return state.get<CopilotPendingPrompt>(pendingKey(id))
}

export async function deleteCopilotPendingPrompt(id: string) {
    await ensureStateConnected()
    await state.delete(pendingKey(id))
}

export async function createCopilotRepoSelection(input: {
    pendingId: string
    threadId: string
    userId: string
    repoFullName: string
}) {
    const selection: CopilotRepoSelection = {
        id: newCopilotId("r"),
        pendingId: input.pendingId,
        threadId: input.threadId,
        userId: input.userId,
        repoFullName: input.repoFullName,
        createdAt: Date.now()
    }

    await ensureStateConnected()
    await state.set(repoSelectionKey(selection.id), selection, COPILOT_PENDING_TTL_MS)
    return selection
}

export async function getCopilotRepoSelection(id: string) {
    await ensureStateConnected()
    return state.get<CopilotRepoSelection>(repoSelectionKey(id))
}

export async function deleteCopilotRepoSelection(id: string) {
    await ensureStateConnected()
    await state.delete(repoSelectionKey(id))
}

export async function getCopilotTask(id: string) {
    await ensureStateConnected()
    return state.get<CopilotTask>(taskKey(id))
}

export async function setCopilotTask(task: CopilotTask) {
    await ensureStateConnected()
    await state.set(taskKey(task.id), task)
}

async function scheduleCopilotPoll(payload: CopilotPollPayload, delaySeconds = COPILOT_POLL_DELAY_SECONDS) {
    const { callbackUrl, qstashToken, qstashUrl } = requireQstashConfig()
    const client = new Client({
        token: qstashToken,
        ...(qstashUrl ? { baseUrl: qstashUrl } : {})
    })

    await client.publishJSON({
        url: callbackUrl,
        body: payload,
        delay: delaySeconds
    })
}

function summarizePrBody(body: string) {
    const trimmed = body.trim()
    if (!trimmed) return "Keine PR-Beschreibung vorhanden."
    return trimmed.slice(0, 350)
}

function isCopilotPrReady(pr: {
    additions: number
    deletions: number
    changedFiles: number
}) {
    if (pr.changedFiles > 0) return true
    return pr.additions + pr.deletions > 0
}

export async function startCopilotTaskFromPending(input: {
    pending: CopilotPendingPrompt
    repoFullName: string
}) {
    const taskId = newCopilotId("t")
    const issue = await createCopilotIssueTask(input.pending.userId, input.repoFullName, input.pending.prompt)

    const task: CopilotTask = {
        id: taskId,
        threadId: input.pending.threadId,
        userId: input.pending.userId,
        repoFullName: input.repoFullName,
        prompt: input.pending.prompt,
        issueNumber: issue.issueNumber,
        issueUrl: issue.issueUrl,
        attempts: 0,
        status: "waiting",
        createdAt: Date.now()
    }

    await setCopilotTask(task)
    await scheduleCopilotPoll({ taskId: task.id }, 20)
    return task
}

export function parseCopilotPollPayload(value: unknown): CopilotPollPayload {
    if (!value || typeof value !== "object") {
        throw new UserError("COPILOT_POLL_INVALID", "Copilot-Payload ist ungültig.")
    }
    const payload = value as Partial<CopilotPollPayload>
    if (!payload.taskId) {
        throw new UserError("COPILOT_POLL_INVALID", "Copilot-Payload ist unvollständig.")
    }
    return { taskId: String(payload.taskId) }
}

export async function processCopilotPoll(payload: CopilotPollPayload) {
    const task = await getCopilotTask(payload.taskId)
    if (!task) return
    if (task.status !== "waiting") return

    const pr = await findCopilotPrForIssue(task.userId, task.repoFullName, task.issueNumber)
    if (pr && isCopilotPrReady(pr)) {
        const stablePolls = task.lastPrHeadSha === pr.headSha ? (task.stablePolls ?? 0) + 1 : 1

        if (stablePolls < COPILOT_REQUIRED_STABLE_POLLS) {
            const attempts = task.attempts + 1
            if (attempts >= COPILOT_MAX_ATTEMPTS) {
                await setCopilotTask({
                    ...task,
                    attempts,
                    status: "timeout",
                    lastPrHeadSha: pr.headSha,
                    stablePolls
                })

                const { bot } = await import("../server/bot.js")
                const adapter = bot.getAdapter("telegram")
                await adapter.postMessage(
                    task.threadId,
                    `Copilot hat den PR noch nicht finalisiert. Issue: ${task.issueUrl}` as never
                )
                return
            }

            await setCopilotTask({
                ...task,
                attempts,
                lastPrHeadSha: pr.headSha,
                stablePolls
            })
            await scheduleCopilotPoll({ taskId: task.id })
            return
        }

        const safeRepoFullName = escapeTelegramMarkdown(task.repoFullName)
        const safePrTitle = escapeTelegramMarkdown(pr.title)
        const safeSummary = escapeTelegramMarkdown(summarizePrBody(pr.body))
        const prActions = [
            { url: pr.url, label: "PR öffnen" },
            { id: "c:copilot:merge", label: "Mergen", value: task.id },
            { id: "c:copilot:reject", label: "Löschen", value: task.id },
            { id: "c:copilot:later", label: "Später", value: task.id }
        ] as const

        const next: CopilotTask = {
            ...task,
            status: "ready",
            prNumber: pr.number,
            prUrl: pr.url,
            lastPrHeadSha: pr.headSha,
            stablePolls
        }
        await setCopilotTask(next)

        const { bot } = await import("../server/bot.js")
        const adapter = bot.getAdapter("telegram")
        const postedCard = await adapter.postMessage(
            task.threadId,
            Card({
                title: "Copilot PR bereit",
                children: [
                    CardText(safeRepoFullName),
                    CardText(safePrTitle),
                    CardText(`+${pr.additions} / -${pr.deletions} in ${pr.changedFiles} Dateien`),
                    ...ButtonGrid({ buttons: prActions, columns: 2 })
                ]
            }) as never
        )
        const prCardMessageIds = Array.from(new Set([...(next.prCardMessageIds ?? []), postedCard.id]))
        await setCopilotTask({ ...next, prCardMessageIds })
        return
    }

    const attempts = task.attempts + 1
    if (attempts >= COPILOT_MAX_ATTEMPTS) {
        await setCopilotTask({
            ...task,
            attempts,
            status: "timeout"
        })

        const { bot } = await import("../server/bot.js")
        const adapter = bot.getAdapter("telegram")
        await adapter.postMessage(
            task.threadId,
            `Copilot hat noch keinen PR erstellt. Issue: ${task.issueUrl}` as never
        )
        return
    }

    await setCopilotTask({
        ...task,
        attempts,
        stablePolls: 0,
        lastPrHeadSha: undefined
    })
    await scheduleCopilotPoll({ taskId: task.id })
}
