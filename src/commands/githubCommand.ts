import { Actions, Button, Card, CardLink, CardText } from "chat"
import { postThreadError } from "../errors/errorOutput.js"
import {
    GithubAuthorizationRequiredError,
    createGithubAuthorizationUrl,
    getGithubAssignedIssues,
    getGithubAssignedPrs,
    getGithubDailyCommitStats,
    isGithubConnected
} from "../integrations/github.js"
import { createCommand, type CommandDefinition } from "../types/command.js"
import { parseMenuActionArgs } from "../lib/commandArgs.js"
import { ACTION_IDS } from "./shared/actionIds.js"
import { postOAuthLoginCard } from "../ui/oauthCards.js"
import { defineCommandModule } from "./shared/module.js"

type GithubAction = "menu" | "login" | "commits" | "issues" | "prs"
type GithubParsedArgs = {
    action: GithubAction
}

const githubCommand: CommandDefinition<"github", GithubParsedArgs> = {
    name: "github",
    argPolicy: { type: "max", max: 1 },
    parseArgs: (args) => parseMenuActionArgs(args, {
        defaultAction: "menu",
        allowedActions: ["login", "commits", "issues", "prs"] as const,
        unknownActionMessage: "Unbekannter GitHub-Subcommand"
    }),
    execute: async (ctx) => {
        const { action } = ctx.parsedArgs

        if (action === "menu") {
            const userId = ctx.message.author.userId
            const connected = await isGithubConnected(userId)

            if (!connected) {
                try {
                    const authorizationUrl = await createGithubAuthorizationUrl(userId)
                    await postOAuthLoginCard(ctx.thread, {
                        title: "GitHub Login",
                        text: "Bitte verbinde zuerst GitHub:",
                        authorizationUrl
                    })
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
                            Button({ id: ACTION_IDS.github.commits, label: "Commits", value: "github commits" }),
                            Button({ id: ACTION_IDS.github.issues, label: "Issues", value: "github issues" }),
                            Button({ id: ACTION_IDS.github.prs, label: "PRs", value: "github prs" })
                        ])
                    ]
                })
            )
            return
        }

        if (action === "login") {
            try {
                const authorizationUrl = await createGithubAuthorizationUrl(ctx.message.author.userId)
                await postOAuthLoginCard(ctx.thread, {
                    title: "GitHub Login",
                    text: "Bitte verbinde GitHub hier:",
                    authorizationUrl
                })
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
                await postOAuthLoginCard(ctx.thread, {
                    title: "GitHub Login",
                    text: "Bitte verbinde zuerst GitHub:",
                    authorizationUrl: error.authorizationUrl
                })
                return
            }

            await postThreadError(ctx.thread, error, "GitHub konnte nicht geladen werden")
        }
    }
}

export const github = createCommand(githubCommand)

export const githubModule = defineCommandModule({
    command: github,
    description: "Zeigt GitHub Commits, Issues und PRs.",
    aliases: ["gh", "git"] as const,
    subcommands: ["login", "commits", "issues", "prs"] as const,
    actionIds: [
        ACTION_IDS.github.login,
        ACTION_IDS.github.commits,
        ACTION_IDS.github.issues,
        ACTION_IDS.github.prs
    ] as const
})
