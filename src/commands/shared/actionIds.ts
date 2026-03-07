export const ACTION_IDS = {
    copilot: {
        repo: "c:copilot:repo",
        merge: "c:copilot:merge",
        reject: "c:copilot:reject",
        later: "c:copilot:later"
    },
    event: {
        confirm: "c:event:confirm"
    },
    fitbit: {
        login: "command:fitbit:login",
        summary: "command:fitbit:summary",
        activity: "command:fitbit:activity",
        week: "command:fitbit:week"
    },
    meetings: {
        login: "command:meetings:login",
        summary: "command:meetings:summary"
    },
    github: {
        login: "command:github:login",
        commits: "command:github:commits",
        issues: "command:github:issues",
        prs: "command:github:prs"
    },
    notion: {
        login: "command:notion:login",
        mcpLogin: "command:notion:mcp-login",
        pages: "command:notion:pages"
    }
} as const
