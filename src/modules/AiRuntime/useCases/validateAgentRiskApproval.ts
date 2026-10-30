import { type compileVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { type AgentRun } from '../models/AgentRun';
import { agentRunStore } from '../stores/agentRunStore';
import {
    type PendingAppActionConfirmation,
    pendingActionConfirmationStore,
} from '../stores/pendingActionConfirmationStore';

import { COMMAND_BATCH_PROJECT_IDENTITY_STALE_REASON, compileAgentRiskApproval } from './compileAgentRiskApproval';
import { evaluateMetricGoalAdmission } from './evaluateMetricGoalAdmission';
import { metricGoalStateCodec } from './metricGoalStateCodec';

type ValidateAgentRiskApprovalInput = {
    approval: ReturnType<typeof compileAgentRiskApproval>;
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>;
    currentRevision: string;
    confirmationId?: string;
};

// `stale` marks the invalid results that mean "the project moved on after the
// proposal was created" — revision drift, live fingerprint drift, or a project
// switch — as opposed to corruption, policy refusal, or actor rotation, which
// are genuine execution failures. Both classes share the reason strings but
// settle differently: stale terminates `invalidated`, everything else `failed`.
export type AgentRiskApprovalValidation = { status: 'valid' } | { status: 'invalid'; reason: string; stale: boolean };

type LiveMetricGoalBinding =
    | { status: 'valid'; state: ReturnType<typeof metricGoalStateCodec>; serializedGoals: string | null }
    | Extract<AgentRiskApprovalValidation, { status: 'invalid' }>;

function metricGoalOrProofChanged(
    pending: PendingAppActionConfirmation | undefined,
    run: AgentRun | undefined,
    serializedGoals: string | null
): boolean {
    return (
        (pending !== undefined &&
            ((pending.approvalSnapshot.metricGoalState ?? null) !== serializedGoals ||
                (pending.approvalSnapshot.agentApproval?.metricGoalState ?? null) !== serializedGoals)) ||
        (run?.plan !== null && run?.plan !== undefined && (run.plan.metricGoalState ?? null) !== serializedGoals)
    );
}

function readStoredMetricGoalState(
    pending: PendingAppActionConfirmation | undefined,
    serializedGoals: string | null
): LiveMetricGoalBinding {
    const state = metricGoalStateCodec(serializedGoals);
    const run = agentRunStore.value?.runs.find((candidate) => candidate.runId === state?.binding?.runId);
    if (metricGoalOrProofChanged(pending, run, serializedGoals)) {
        return { status: 'invalid', reason: 'The metric goal or proof changed after approval.', stale: true };
    }
    if (
        state?.binding !== undefined &&
        state?.binding !== null &&
        ((pending?.approvalSnapshot.batchPosition !== undefined &&
            pending.approvalSnapshot.batchPosition.index !== state.binding.schedulePosition) ||
            (run?.plan?.batchSchedule !== undefined &&
                run.plan.batchSchedule.position !== state.binding.schedulePosition))
    ) {
        return { status: 'invalid', reason: 'The metric goal proof belongs to another scheduled batch.', stale: true };
    }
    return { status: 'valid', state, serializedGoals };
}

function readLiveMetricGoalBinding(input: ValidateAgentRiskApprovalInput): LiveMetricGoalBinding {
    const serializedGoals = input.approval.metricGoalState ?? null;
    const pending = pendingActionConfirmationStore.value?.confirmations.find((confirmation) => {
        if (input.confirmationId !== undefined) {
            return confirmation.id === input.confirmationId;
        }
        return (
            (confirmation.status === 'proposed' || confirmation.status === 'accepted') &&
            confirmation.approvalSnapshot.commandBatch?.serialized === input.commandBatch.serialized
        );
    });
    if (
        input.confirmationId !== undefined &&
        (pending === undefined ||
            (pending.status !== 'proposed' && pending.status !== 'accepted') ||
            pending.approvalSnapshot.commandBatch?.serialized !== input.commandBatch.serialized)
    ) {
        return {
            status: 'invalid',
            reason: 'The metric goal approval no longer belongs to a live confirmation.',
            stale: true,
        };
    }
    return readStoredMetricGoalState(pending, serializedGoals);
}

export function validateAgentRiskApproval(input: ValidateAgentRiskApprovalInput): AgentRiskApprovalValidation {
    if (input.currentRevision !== input.approval.sourceRevision) {
        return { status: 'invalid', reason: 'The approved source revision is stale.', stale: true };
    }
    const liveBinding = readLiveMetricGoalBinding(input);
    if (liveBinding.status === 'invalid') {
        return liveBinding;
    }
    const { state, serializedGoals } = liveBinding;
    const metricAdmission = evaluateMetricGoalAdmission({
        state,
        commandBatch: input.commandBatch,
        currentRevision: input.currentRevision,
    });

    let current: ReturnType<typeof compileAgentRiskApproval>;
    try {
        current = compileAgentRiskApproval({
            commandBatch: input.commandBatch,
            requireExplicitApproval: input.approval.policy.decision === 'confirm',
            metricGoalState: serializedGoals,
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
    if (metricAdmission.status === 'blocked') {
        return {
            status: 'invalid',
            reason: metricAdmission.reason ?? 'Metric goal verification is required.',
            stale: metricAdmission.failure === 'stale',
        };
    }
    return { status: 'valid' };
}
