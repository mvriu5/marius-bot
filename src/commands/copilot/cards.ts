import { Actions, Card, CardText, LinkButton } from "chat"
import { ButtonGrid } from "../../ui/buttonGrid.js"
import { createSingleLinkActions } from "../../ui/cards.js"

export function createRepoSelectionCard(prompt: string, buttons: Array<{ id: string; label: string; value: string }>) {
    return Card({
        title: "Copilot: Repository auswählen",
        children: [
            CardText(`Prompt: ${prompt.slice(0, 250)}`),
            CardText("Wähle ein Repository:"),
            ...ButtonGrid({
                buttons,
                columns: 1
            })
        ]
    })
}

export function createStartedCard(repoFullName: string, issueUrl: string) {
    return Card({
        title: "Copilot arbeitet",
        children: [
            CardText(`Repo: ${repoFullName}`),
            CardText("Ich schreibe dir sobald ich fertig bin."),
            createSingleLinkActions(issueUrl)
        ]
    })
}

export function createMergeSuccessCard(prNumber: number, prUrl?: string) {
    return Card({
        title: `PR #${prNumber} wurde erfolgreich gemerged.`,
        children: prUrl ? [Actions([LinkButton({ url: prUrl, label: "Öffnen" })])] : []
    })
}

export function createCloseSuccessCard(prUrl?: string) {
    return Card({
        title: "PR wurde geschlossen.",
        children: prUrl ? [Actions([LinkButton({ url: prUrl, label: "Öffnen" })])] : []
    })
}
