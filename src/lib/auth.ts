let warnedAboutMissingOwnerId = false

function getOwnerTelegramUserId() {
    const ownerId = process.env.TELEGRAM_OWNER_USER_ID?.trim()
    if (!ownerId) {
        if (!warnedAboutMissingOwnerId) {
            warnedAboutMissingOwnerId = true
            console.warn("[auth] TELEGRAM_OWNER_USER_ID is empty. All users are blocked.")
        }
        return null
    }
    return ownerId
}

export function isAuthorizedTelegramUser(userId: string | undefined) {
    if (!userId) return false
    const ownerId = getOwnerTelegramUserId()
    return Boolean(ownerId && userId === ownerId)
}
