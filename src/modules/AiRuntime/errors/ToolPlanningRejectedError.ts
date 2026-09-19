import { type HostedToolPlanUsage } from '../models/HostedToolPlanUsage';

export class ToolPlanningRejectedError extends Error {
    override readonly name = 'ToolPlanningRejectedError';
    /**
     * The provider's own usage figure for the turn that got rejected, read from the response
     * body before the rejection was decided. `null` when the body never became readable (a
     * non-JSON body, a wrong content type) rather than when the provider simply omitted usage.
     */
    readonly usage: HostedToolPlanUsage | null;

    constructor(message?: string, usage: HostedToolPlanUsage | null = null) {
        super(message);
        this.usage = usage;
    }
}

export function isToolPlanningRejectedError(error: unknown): error is ToolPlanningRejectedError {
    return error instanceof Error && error.name === 'ToolPlanningRejectedError';
}
