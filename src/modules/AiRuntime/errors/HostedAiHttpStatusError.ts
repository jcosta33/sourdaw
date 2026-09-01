export class HostedAiHttpStatusError extends Error {
    override readonly name = 'HostedAiHttpStatusError';
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export function isHostedAiHttpStatusError(error: unknown): error is HostedAiHttpStatusError {
    return (
        error instanceof Error &&
        error.name === 'HostedAiHttpStatusError' &&
        'status' in error &&
        typeof (error as HostedAiHttpStatusError).status === 'number'
    );
}
