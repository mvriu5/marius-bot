import { Chat } from "chat"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import { createRedisState } from "@chat-adapter/state-redis"

export const bot = new Chat({
    userName: "mvriu5_bot",
    state: createRedisState(),
    adapters: {
        telegram: createTelegramAdapter(),
    },
})

bot.onNewMention(async (thread, message) => {
    await thread.post(`You said: ${message.text}`);
})
