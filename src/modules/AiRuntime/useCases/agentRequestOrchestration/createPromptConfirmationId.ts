export function createPromptConfirmationId(): string {
    return `prompt-confirmation-${crypto.randomUUID()}`;
}
