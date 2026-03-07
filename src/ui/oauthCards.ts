import { Actions, Card, CardText, LinkButton, type Thread } from "chat"

export async function postOAuthLoginCard(
    thread: Thread<Record<string, unknown>, unknown>,
    options: {
        title: string
        text: string
        authorizationUrl: string
        buttonLabel?: string
    }
) {
    await thread.post(
        Card({
            title: options.title,
            children: [
                CardText(options.text),
                Actions([
                    LinkButton({
                        url: options.authorizationUrl,
                        label: options.buttonLabel ?? "Login"
                    })
                ])
            ]
        })
    )
}
