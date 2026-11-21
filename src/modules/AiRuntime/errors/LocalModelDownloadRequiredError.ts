/**
 * The local model's artifacts cannot be used without a fresh download, and this browser has not consented to one.
 * A planner turns it into a `denied` outcome naming the remedy, as it does for `NoAiBackendError`.
 */
export class LocalModelDownloadRequiredError extends Error {
    override readonly name = 'LocalModelDownloadRequiredError';

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

/** Read by name, because the application-owned tool loop rethrows a turn's error under that error's name. */
export function isLocalModelDownloadRequiredError(error: unknown): error is LocalModelDownloadRequiredError {
    return error instanceof Error && error.name === 'LocalModelDownloadRequiredError';
}
