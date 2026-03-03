import { Actions, Button, Card, CardLink, CardText, LinkButton } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import {
    GithubAuthorizationRequiredError,
    createGithubAuthorizationUrl,
    getGithubAssignedIssues,
    getGithubAssignedPrs,
    getGithubDailyCommitStats,
    isGithubConnected
} from "../lib/github.js"
import { Command, type CommandDefinition } from "../types/command.js"

type GithubAction = "menu" | "login" | "commits" | "issues" | "prs"
type GithubParsedArgs = {
    action: GithubAction
}

const githubCommand: CommandDefinition<"github", GithubParsedArgs> = {
    name: "github",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => {
        const action = args[0]
        if (!action) return { ok: true, value: { action: "menu" as const } }
        if (action === "login" || action === "commits" || action === "issues" || action === "prs") {
            return { ok: true, value: { action } }
        }
        return { ok: false, message: "Unbekannter GitHub-Subcommand" }
    },
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs

        if (action === "menu") {
            const userId = ctx.message.author.userId
            const connected = await isGithubConnected(userId)

            if (!connected) {
                try {
                    const authorizationUrl = await createGithubAuthorizationUrl(userId)
                    await ctx.thread.post(
                        Card({
                            title: "GitHub Login",
                            children: [
                                CardText("Bitte verbinde zuerst GitHub:"),
                                Actions([LinkButton({ url: authorizationUrl, label: "Login" })])
                            ]
                        })
                    )
                } catch (error) {
                    await postThreadError(ctx.thread, error, "GitHub Login konnte nicht gestartet werden")
                }
                return
            }

            await ctx.thread.post(
                Card({
                    title: "GitHub",
                    children: [
                        CardText("Wähle einen Subcommand:"),
                        Actions([
                            Button({ id: "command:github:commits", label: "Commits", value: "github commits" }),
                            Button({ id: "command:github:issues", label: "Issues", value: "github issues" }),
                            Button({ id: "command:github:prs", label: "PRs", value: "github prs" })
                        ])
                    ]
                })
            )
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createGithubAuthorizationUrl(ctx.message.author.userId)
                await ctx.thread.post(
                    Card({
                        title: "GitHub Login",
                        children: [
                            CardText("Bitte verbinde GitHub hier:"),
                            Actions([LinkButton({ url: authorizationUrl, label: "Login" })])
                        ]
                    })
                )
            } catch (error) {
                await postThreadError(ctx.thread, error, "GitHub Login konnte nicht gestartet werden")
            }
            return
        }

        try {
            if (action === "commits") {
                const stats = await getGithubDailyCommitStats(ctx.message.author.userId)
                const breakdown = stats.byRepository.length === 0
                    ? "Keine Commits in Repositories gefunden."
                    : stats.byRepository.map((entry) => `- ${entry.repository}: ${entry.count}`).join("\n")

                await ctx.thread.post(
                    Card({
                        title: "GitHub Commits Heute",
                        children: [
                            CardText(`Anzahl: ${stats.totalCommitsToday}`),
                            CardText("Nach Repository:"),
                            CardText(breakdown)
                        ]
                    })
                )
                return
            }

            if (action === "issues") {
                const issues = await getGithubAssignedIssues(ctx.message.author.userId, 10)
                await ctx.thread.post(
                    Card({
                        title: "Meine zugewiesenen Issues",
                        children: issues.length === 0
                            ? [CardText("Aktuell keine zugewiesenen offenen Issues.")]
                            : issues.map((issue, index) =>
                                CardLink({
                                    url: issue.url,
                                    label: `${index + 1}. [${issue.repository}] #${issue.number ?? "?"} ${issue.title}`
                                })
                            )
                    })
                )
                return
            }

            const prs = await getGithubAssignedPrs(ctx.message.author.userId, 10)
            await ctx.thread.post(
                Card({
                    title: "Meine zugewiesenen PRs",
                    children: prs.length === 0
                        ? [CardText("Aktuell keine zugewiesenen offenen PRs.")]
                        : prs.map((pr, index) =>
                            CardLink({
                                url: pr.url,
                                label: `${index + 1}. [${pr.repository}] #${pr.number ?? "?"} ${pr.title}`
                            })
                        )
                })
            )
        } catch (error) {
            if (error instanceof GithubAuthorizationRequiredError) {
                await ctx.thread.post(
                    Card({
                        title: "GitHub Login",
                        children: [
                            CardText("Bitte verbinde zuerst GitHub:"),
                            Actions([LinkButton({ url: error.authorizationUrl, label: "Login" })])
                        ]
                    })
                )
                return
            }

            await postThreadError(ctx.thread, error, "GitHub konnte nicht geladen werden")
        }
    }
}

export const github = new Command(githubCommand)
