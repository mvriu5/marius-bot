import { Actions, Card, CardText, LinkButton } from "chat"

export function createTextCard(title: string, lines: readonly string[]) {
    return Card({
        title,
        children: lines.map((line) => CardText(line))
    })
}

export function createSingleLinkActions(url: string, label = "Öffnen") {
    return Actions([LinkButton({ url, label })])
}
