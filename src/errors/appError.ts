type AppErrorKind = "user" | "auth" | "provider"

type AppErrorInput = {
    code: string
    userMessage: string
    status: number
    details?: string
    cause?: unknown
}

abstract class AppError extends Error {
    public readonly kind: AppErrorKind
    public readonly code: string
    public readonly userMessage: string
    public readonly status: number
    public readonly details?: string

    protected constructor(kind: AppErrorKind, input: AppErrorInput) {
        super(input.details ?? input.userMessage, { cause: input.cause })
        this.name = `${kind[0].toUpperCase()}${kind.slice(1)}Error`
        this.kind = kind
        this.code = input.code
        this.userMessage = input.userMessage
        this.status = input.status
        this.details = input.details
    }
}

export class UserError extends AppError {
    constructor(code: string, userMessage: string, details?: string, cause?: unknown) {
        super("user", { code, userMessage, status: 400, details, cause })
    }
}

export class AuthError extends AppError {
    constructor(code: string, userMessage: string, status = 401, details?: string, cause?: unknown) {
        super("auth", { code, userMessage, status, details, cause })
    }
}

export class ProviderError extends AppError {
    public readonly provider: string

    constructor(provider: string, code: string, userMessage: string, status = 502, details?: string, cause?: unknown) {
        super("provider", { code, userMessage, status, details, cause })
        this.provider = provider
    }
}

export function normalizeError(error: unknown): AppError {
    if (error instanceof AppError) return error

    if (error instanceof Error) {
        return new ProviderError(
            "internal",
            "UNEXPECTED",
            "Interner Fehler. Bitte später erneut versuchen.",
            500,
            error.message,
            error
        )
    }

    return new ProviderError(
        "internal",
        "UNKNOWN",
        "Interner Fehler. Bitte später erneut versuchen.",
        500,
        String(error)
    )
}
