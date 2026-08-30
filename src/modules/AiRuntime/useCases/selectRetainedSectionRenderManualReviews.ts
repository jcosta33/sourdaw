import { getExactAgentSectionRenderArtifact } from '#/modules/AudioRendering/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { type AgentRunPendingEffectContinuation, type AgentRunState } from '../models/AgentRun';

type RetainedRenderJobReview = {
    commandId: string;
    job: RenderProjectSectionJobSnapshot;
} & (
    | {
          availability: 'available';
          artifact: NonNullable<ReturnType<typeof getExactAgentSectionRenderArtifact>>;
          warnings: readonly string[];
      }
    | { availability: 'unavailable'; reason: string; warnings: readonly [] }
);

type RetainedSectionRenderManualReviewBinding = {
    runId: string;
    batchId: string;
    receiptIdentity: string;
    sourceRevision: string;
    commands: Array<{ commandId: string; jobs: RenderProjectSectionJobSnapshot[] }>;
};

type RetainedSectionRenderManualReview = {
    binding: RetainedSectionRenderManualReviewBinding;
    jobs: RetainedRenderJobReview[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactPartiallyCommittedReceiptIdentity(identity: string, runId: string, batchId: string): boolean {
    const [schemaVersion, receiptRunId, receiptBatchId, outcome, ...remainder] = identity.split(':');
    return (
        remainder.length === 0 &&
        schemaVersion !== undefined &&
        /^\d+$/.test(schemaVersion) &&
        Number(schemaVersion) > 0 &&
        receiptRunId === runId &&
        receiptBatchId === batchId &&
        outcome === 'partially-committed'
    );
}

function hasSameValue(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((entry, index) => hasSameValue(entry, right[index]))
        );
    }
    if (!isRecord(left) || !isRecord(right)) {
        return false;
    }
    const leftKeys = Object.keys(left).toSorted();
    const rightKeys = Object.keys(right).toSorted();
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && hasSameValue(left[key], right[key]))
    );
}

function hasExactDurableBinding(
    continuation: AgentRunPendingEffectContinuation,
    recovery: NonNullable<AgentRunState['pendingEffectRecoveryLedger']>[number]
): boolean {
    return (
        recovery.checkpoint === 'durable' &&
        recovery.batchId === continuation.batchId &&
        recovery.receiptIdentity === continuation.receiptIdentity &&
        recovery.serializedBatch === continuation.serializedBatch &&
        recovery.recovery === continuation.recovery &&
        recovery.lastError === continuation.lastError &&
        recovery.sourceRevision === continuation.sourceRevision &&
        hasSameValue(recovery.authority, continuation.authority) &&
        hasSameValue(recovery.effects, continuation.effects)
    );
}

function isRenderJob(value: unknown): value is RenderProjectSectionJobSnapshot {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.jobId === 'string' &&
        value.jobId.length > 0 &&
        typeof value.sectionId === 'string' &&
        value.sectionId.length > 0 &&
        typeof value.sectionName === 'string' &&
        value.sectionName.length > 0 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        typeof value.sampleRate === 'number' &&
        Number.isFinite(value.sampleRate) &&
        value.sampleRate > 0 &&
        typeof value.tailSeconds === 'number' &&
        Number.isFinite(value.tailSeconds) &&
        value.tailSeconds >= 0
    );
}

function getExactRenderCommands(continuation: AgentRunPendingEffectContinuation, runId: string) {
    const parsed = parseVersionedCommandBatchEnvelope(continuation.serializedBatch, continuation.authority);
    if (
        parsed.status === 'invalid' ||
        parsed.envelope.runId !== runId ||
        parsed.envelope.batchId !== continuation.batchId ||
        continuation.effects.length === 0
    ) {
        return null;
    }
    const effectCommandIds = new Set(continuation.effects.map(({ commandId }) => commandId));
    if (effectCommandIds.size !== continuation.effects.length) {
        return null;
    }
    const commands: RetainedSectionRenderManualReviewBinding['commands'] = [];
    const seenJobIds = new Set<string>();
    for (const effect of continuation.effects) {
        if (
            effect.kind !== 'external-effect' ||
            effect.operation !== 'renderProjectSections' ||
            effect.remediation !== 'manual-repair'
        ) {
            return null;
        }
        const matchingCommands = parsed.envelope.commands.filter(({ commandId }) => commandId === effect.commandId);
        if (matchingCommands.length !== 1 || matchingCommands[0]?.operation !== 'renderProjectSections') {
            return null;
        }
        const command = matchingCommands[0];
        const jobs = command.arguments.jobs;
        if (!Array.isArray(jobs) || jobs.length === 0 || !jobs.every(isRenderJob)) {
            return null;
        }
        for (const { jobId } of jobs) {
            if (seenJobIds.has(jobId)) {
                return null;
            }
            seenJobIds.add(jobId);
        }
        commands.push({ commandId: command.commandId, jobs: structuredClone(jobs) });
    }
    return commands;
}

/** Joins one durable run-and-batch obligation to every exact retained render artifact it owns. */
export function selectRetainedSectionRenderManualReviews(
    state: AgentRunState | null | undefined
): RetainedSectionRenderManualReview[] {
    const reviews: RetainedSectionRenderManualReview[] = [];
    for (const run of state?.runs ?? []) {
        if (state?.runs.filter(({ runId }) => runId === run.runId).length !== 1) {
            continue;
        }
        for (const continuation of run.pendingEffectContinuations) {
            const sourceRevision = continuation.sourceRevision;
            if (
                continuation.recovery !== 'manual-repair' ||
                !sourceRevision ||
                run.pendingEffectContinuations.filter(({ batchId }) => batchId === continuation.batchId).length !== 1
            ) {
                continue;
            }
            const receipts = run.receipts.filter(({ workId }) => workId === continuation.batchId);
            if (
                !hasExactPartiallyCommittedReceiptIdentity(
                    continuation.receiptIdentity,
                    run.runId,
                    continuation.batchId
                ) ||
                receipts.length !== 1 ||
                receipts[0]?.receiptIdentity !== continuation.receiptIdentity
            ) {
                continue;
            }
            const recoveries = (state?.pendingEffectRecoveryLedger ?? []).filter(
                (candidate) => candidate.runId === run.runId && candidate.batchId === continuation.batchId
            );
            if (recoveries.length !== 1 || !hasExactDurableBinding(continuation, recoveries[0]!)) {
                continue;
            }
            const commands = getExactRenderCommands(continuation, run.runId);
            if (!commands) {
                continue;
            }
            const jobs: RetainedRenderJobReview[] = commands.flatMap(({ commandId, jobs: commandJobs }) =>
                commandJobs.map((job) => {
                    const artifact = getExactAgentSectionRenderArtifact({ job, sourceRevision });
                    return artifact
                        ? { commandId, job, availability: 'available' as const, artifact, warnings: artifact.warnings }
                        : {
                              commandId,
                              job,
                              availability: 'unavailable' as const,
                              warnings: [] as const,
                              reason: 'The exact retained render evidence has expired, was evicted, or no longer matches this receipt.',
                          };
                })
            );
            reviews.push({
                binding: {
                    runId: run.runId,
                    batchId: continuation.batchId,
                    receiptIdentity: continuation.receiptIdentity,
                    sourceRevision,
                    commands,
                },
                jobs,
            });
        }
    }
    return reviews;
}
