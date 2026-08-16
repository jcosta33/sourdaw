import { type AgentRunErrorRemediation } from '../models/AgentRun';

export function admitAgentRetry(input: {
    operation: 'read' | 'write';
    ownerProvesIdempotent: boolean;
    cancellationRequested: boolean;
    stale: boolean;
}): AgentRunErrorRemediation['retry'] {
    if (input.cancellationRequested || input.stale) {
        return 'never';
    }
    if (input.operation === 'read') {
        return 'read-only';
    }
    return input.ownerProvesIdempotent ? 'owner-proven-idempotent' : 'never';
}
