import { Actions, Button, Card, CardLink, CardText, LinkButton } from "chat"
import {
    GithubAuthorizationRequiredError,
    createGithubAuthorizationUrl,
    getGithubAssignedIssues,
    getGithubAssignedPrs,
    getGithubDailyCommitStats
} from "../lib/github.js"
import { Command, type CommandDefinition } from "../types/command.js"

type GithubArgs = [] | [action: "login" | "commits" | "issues" | "prs"]

const githubCommand: CommandDefinition<"github", GithubArgs> = {
    name: "github",
    argPolicy: { type: "any" },
    execute: async (ctx) => {
        const action = ctx.args[0]

        if (!action) {
            await ctx.thread.post(
                Card({
                    title: "GitHub",
                    children: [
                        CardText("Waehle einen Subcommand:"),
                        Actions([
                            Button({ id: "command:github:login", label: "Login", value: "github login" }),
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
                const details = error instanceof Error ? error.message : String(error)
                await ctx.thread.post(`⚠️ GitHub Login konnte nicht gestartet werden: ${details}`)
            }
            return
        }

        if (action !== "commits" && action !== "issues" && action !== "prs") {
            await ctx.thread.post("⚠️ Unbekannter GitHub-Subcommand.")
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

            const details = error instanceof Error ? error.message : String(error)
            await ctx.thread.post(`⚠️ GitHub konnte nicht geladen werden: ${details}`)
        }
    }
}

export const github = new Command(githubCommand)
