import { type HostedToolPlanUsage } from '../models/HostedToolPlanUsage';

export class HostedToolCallingProtocolError extends Error {
    override readonly name = 'HostedToolCallingProtocolError';
    readonly usage: HostedToolPlanUsage | null;

    constructor(message?: string, usage: HostedToolPlanUsage | null = null) {
        super(message);
        this.usage = usage;
    }
}

export function isHostedToolCallingProtocolError(error: unknown): error is HostedToolCallingProtocolError {
    return error instanceof Error && error.name === 'HostedToolCallingProtocolError';
}
