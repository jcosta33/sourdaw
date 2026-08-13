import { type compileVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { compileAgentRiskApproval } from './compileAgentRiskApproval';

type ValidateAgentRiskApprovalInput = {
    approval: ReturnType<typeof compileAgentRiskApproval>;
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>;
    currentRevision: string;
};

export function validateAgentRiskApproval(input: ValidateAgentRiskApprovalInput) {
    if (input.currentRevision !== input.approval.sourceRevision) {
        return { status: 'invalid' as const, reason: 'The approved source revision is stale.' };
    }
    let current: ReturnType<typeof compileAgentRiskApproval>;
    try {
        current = compileAgentRiskApproval({ commandBatch: input.commandBatch });
    } catch (error) {
        return {
            status: 'invalid' as const,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
    if (JSON.stringify(current.actionHashes) !== JSON.stringify(input.approval.actionHashes)) {
        return { status: 'invalid' as const, reason: 'The approved action hashes no longer match.' };
    }
    if (JSON.stringify(current.targetFingerprints) !== JSON.stringify(input.approval.targetFingerprints)) {
        return { status: 'invalid' as const, reason: 'The approved target fingerprints no longer match.' };
    }
    if (JSON.stringify(current.consequences) !== JSON.stringify(input.approval.consequences)) {
        return { status: 'invalid' as const, reason: 'The approved cost or data consequences no longer match.' };
    }
    if (JSON.stringify(current.policy) !== JSON.stringify(input.approval.policy)) {
        return { status: 'invalid' as const, reason: 'The approved trust mode or risk policy no longer matches.' };
    }
    if (current.localActorId !== input.approval.localActorId) {
        return { status: 'invalid' as const, reason: 'The local actor no longer matches the approval.' };
    }
    return { status: 'valid' as const };
}
