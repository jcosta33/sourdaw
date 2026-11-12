/**
 * No backend in the chain can run the request. A planner turns it into a `denied` outcome naming the
 * remedy, so the user reads how to enable a model rather than a provider failure.
 */
export class NoAiBackendError extends Error {
    override readonly name = 'NoAiBackendError';

    constructor() {
        super('No AI backend available. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.');
    }
}

/** Read by name, because the application-owned tool loop rethrows a turn's error under that error's name. */
export function isNoAiBackendError(error: unknown): boolean {
    return error instanceof Error && error.name === 'NoAiBackendError';
}
