export type CopilotAction = "start" | "repo" | "login" | "merge" | "reject" | "later"

export type CopilotParsedArgs =
    | { action: "start"; prompt: string }
    | { action: "repo"; selectionId: string }
    | { action: "login" }
    | { action: "merge"; taskId: string }
    | { action: "reject"; taskId: string }
    | { action: "later"; taskId: string }
