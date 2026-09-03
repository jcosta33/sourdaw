export class HostedAiHttpStatusError extends Error {
    override readonly name = 'HostedAiHttpStatusError';
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

function isFiniteHttpStatus(status: unknown): status is number {
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599;
}

export function snapshotHostedAiHttpStatus(error: unknown): number | null {
    if (!(error instanceof Error)) {
        return null;
    }
    if (error.name !== 'HostedAiHttpStatusError') {
        return null;
    }
    if (!('status' in error)) {
        return null;
    }
    const status: unknown = error.status;
    return isFiniteHttpStatus(status) ? status : null;
}

export function isHostedAiHttpStatusError(error: unknown): error is HostedAiHttpStatusError {
    return snapshotHostedAiHttpStatus(error) !== null;
}
