import { getExactAgentSectionRenderArtifact } from '#/modules/AudioRendering/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { type AgentRunPendingEffectContinuation, type AgentRunState } from '../models/AgentRun';

export type RetainedSectionRenderManualReviewProjection = {
    runId: string;
    batchId: string;
    receiptIdentity: string;
    commandId: string;
    job: RenderProjectSectionJobSnapshot;
    sourceRevision: string;
    warnings: readonly string[];
} & (
    | { availability: 'available'; artifact: NonNullable<ReturnType<typeof getExactAgentSectionRenderArtifact>> }
    | { availability: 'unavailable'; reason: string }
);

function getRenderJobs(continuation: AgentRunPendingEffectContinuation, runId: string, sourceRevision: string) {
    const parsed = parseVersionedCommandBatchEnvelope(continuation.serializedBatch, continuation.authority);
    if (
        parsed.status === 'invalid' ||
        parsed.envelope.runId !== runId ||
        parsed.envelope.batchId !== continuation.batchId
    ) {
        return { reason: 'The receipt-bound command batch is malformed or no longer authoritative.' } as const;
    }
    const commands = parsed.envelope.commands.filter((command) => command.operation === 'renderProjectSections');
    if (
        commands.length !== continuation.effects.length ||
        continuation.effects.some(
            (effect) =>
                effect.kind !== 'external-effect' ||
                effect.operation !== 'renderProjectSections' ||
                effect.remediation !== 'manual-repair' ||
                !commands.some((command) => command.commandId === effect.commandId)
        )
    ) {
        return { reason: 'This manual repair includes non-render or mismatched effects.' } as const;
    }
    const projected: Array<{ commandId: string; job: RenderProjectSectionJobSnapshot }> = [];
    for (const command of commands) {
        const jobs = command.arguments.jobs;
        if (!Array.isArray(jobs) || jobs.length === 0) {
            return { reason: 'The receipt-bound render job payload is malformed.' } as const;
        }
        for (const job of jobs) {
            if (!job || typeof job !== 'object') {
                return { reason: 'The receipt-bound render job payload is malformed.' } as const;
            }
            const candidate = job as RenderProjectSectionJobSnapshot;
            if (
                !Number.isFinite(candidate.startBeat) ||
                !Number.isFinite(candidate.endBeat) ||
                !Number.isFinite(candidate.sampleRate) ||
                !Number.isFinite(candidate.tailSeconds) ||
                !candidate.jobId ||
                !candidate.sectionId ||
                !candidate.sectionName
            ) {
                return { reason: 'The receipt-bound render job payload is malformed.' } as const;
            }
            projected.push({ commandId: command.commandId, job: candidate });
        }
    }
    return { projected, sourceRevision } as const;
}

/** Derived review surface: durable continuation evidence joined to one current retained artifact. */
export function selectRetainedSectionRenderManualReviews(
    state: AgentRunState | null | undefined
): RetainedSectionRenderManualReviewProjection[] {
    const output: RetainedSectionRenderManualReviewProjection[] = [];
    for (const run of state?.runs ?? []) {
        for (const continuation of run.pendingEffectContinuations) {
            const sourceRevision = continuation.sourceRevision;
            if (continuation.recovery !== 'manual-repair' || !sourceRevision) {
                continue;
            }
            const recovery = (state.pendingEffectRecoveryLedger ?? []).find(
                (candidate) =>
                    candidate.runId === run.runId &&
                    candidate.batchId === continuation.batchId &&
                    candidate.checkpoint === 'durable'
            );
            if (
                !recovery ||
                recovery.receiptIdentity !== continuation.receiptIdentity ||
                recovery.serializedBatch !== continuation.serializedBatch ||
                JSON.stringify(recovery.authority) !== JSON.stringify(continuation.authority) ||
                JSON.stringify(recovery.effects) !== JSON.stringify(continuation.effects) ||
                recovery.sourceRevision !== continuation.sourceRevision ||
                recovery.recovery !== continuation.recovery
            ) {
                continue;
            }
            const jobs = getRenderJobs(continuation, run.runId, sourceRevision);
            if ('reason' in jobs) {
                continue;
            }
            for (const { commandId, job } of jobs.projected) {
                const artifact = getExactAgentSectionRenderArtifact({ job, sourceRevision });
                if (artifact) {
                    output.push({
                        runId: run.runId,
                        batchId: continuation.batchId,
                        receiptIdentity: continuation.receiptIdentity,
                        commandId,
                        job,
                        sourceRevision,
                        warnings: artifact.warnings,
                        availability: 'available',
                        artifact,
                    });
                } else {
                    output.push({
                        runId: run.runId,
                        batchId: continuation.batchId,
                        receiptIdentity: continuation.receiptIdentity,
                        commandId,
                        job,
                        sourceRevision,
                        warnings: [],
                        availability: 'unavailable',
                        reason: 'The exact retained render evidence has expired, was evicted, or no longer matches this receipt.',
                    });
                }
            }
        }
    }
    return output;
}
