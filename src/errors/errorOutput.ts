import type { Thread } from "chat"
import { normalizeError } from "./appError.js"

type HttpErrorBody = {
    ok: false
    error: {
        type: "user" | "auth" | "provider"
        code: string
        message: string
    }
}

type HttpStatus = 400 | 401 | 500 | 502

function toContentfulStatus(status: number): HttpStatus {
    if (status === 400) return 400
    if (status === 401) return 401
    if (status === 502) return 502
    return 500
}

function formatThreadError(error: unknown, context?: string) {
    const normalized = normalizeError(error)
    const message = context ? `${context}: ${normalized.userMessage}` : normalized.userMessage

    return { normalized, text: `⚠️ ${message}` }
}

export async function postThreadError(thread: Thread<Record<string, unknown>, unknown>, error: unknown, context?: string) {
    const { normalized, text } = formatThreadError(error, context)
    logError(context ?? "thread", error)
    await thread.post(text)
    return normalized
}

export function toHttpError(error: unknown): { status: HttpStatus; body: HttpErrorBody } {
    const normalized = normalizeError(error)
    return {
        status: toContentfulStatus(normalized.status),
        body: {
            ok: false,
            error: {
                type: normalized.kind,
                code: normalized.code,
                message: normalized.userMessage
            }
        }
    }
}

export function logError(context: string, error: unknown) {
    const normalized = normalizeError(error)
    console.error(`[${context}]`, {
        type: normalized.kind,
        code: normalized.code,
        message: normalized.userMessage,
        details: normalized.details,
        status: normalized.status,
        stack: normalized.stack
    })
}
