import { type compileVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { COMMAND_BATCH_PROJECT_IDENTITY_STALE_REASON, compileAgentRiskApproval } from './compileAgentRiskApproval';

type ValidateAgentRiskApprovalInput = {
    approval: ReturnType<typeof compileAgentRiskApproval>;
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>;
    currentRevision: string;
};

// `stale` marks the invalid results that mean "the project moved on after the
// proposal was created" — revision drift, live fingerprint drift, or a project
// switch — as opposed to corruption, policy refusal, or actor rotation, which
// are genuine execution failures. Both classes share the reason strings but
// settle differently: stale terminates `invalidated`, everything else `failed`.
export type AgentRiskApprovalValidation = { status: 'valid' } | { status: 'invalid'; reason: string; stale: boolean };

export function validateAgentRiskApproval(input: ValidateAgentRiskApprovalInput): AgentRiskApprovalValidation {
    if (input.currentRevision !== input.approval.sourceRevision) {
        return { status: 'invalid', reason: 'The approved source revision is stale.', stale: true };
    }
    let current: ReturnType<typeof compileAgentRiskApproval>;
    try {
        current = compileAgentRiskApproval({
            commandBatch: input.commandBatch,
            requireExplicitApproval: input.approval.policy.decision === 'confirm',
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { status: 'invalid', reason, stale: reason === COMMAND_BATCH_PROJECT_IDENTITY_STALE_REASON };
    }
    if (JSON.stringify(current.actionHashes) !== JSON.stringify(input.approval.actionHashes)) {
        return { status: 'invalid', reason: 'The approved action hashes no longer match.', stale: false };
    }
    if (
        JSON.stringify(current.targetFingerprints) !== JSON.stringify(input.approval.targetFingerprints) ||
        JSON.stringify(current.advertisedTargetFingerprints) !==
            JSON.stringify(input.approval.advertisedTargetFingerprints)
    ) {
        return { status: 'invalid', reason: 'The approved target fingerprints no longer match.', stale: true };
    }
    if (JSON.stringify(current.consequences) !== JSON.stringify(input.approval.consequences)) {
        return { status: 'invalid', reason: 'The approved cost or data consequences no longer match.', stale: false };
    }
    if (JSON.stringify(current.policy) !== JSON.stringify(input.approval.policy)) {
        return { status: 'invalid', reason: 'The approved trust mode or risk policy no longer matches.', stale: false };
    }
    if (current.localActorId !== input.approval.localActorId) {
        return { status: 'invalid', reason: 'The local actor no longer matches the approval.', stale: false };
    }
    return { status: 'valid' };
}
