import { cancelExport, renderOffline } from '#/modules/AudioEngine/useCases';
import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '#/modules/CrdtDocument/useCases';
import {
    cloneAgentWorkOwnerIdentity,
    getAudioBufferContentAddress,
    type AgentRenderProvenance,
    type AgentRenderReceipt,
    type AgentWorkOwnerIdentity,
} from '#/utils/agentRenderReceipt';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { type AgentSectionRenderArtifact } from '../models/AgentSectionRenderArtifact';
import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../models/AgentSectionRenderRetentionPolicy';
import { SectionRenderFollowUpError, SectionRenderRetentionCapacityError } from '../models/SectionRenderFollowUpError';
import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

import { pruneExpiredAgentSectionRenderArtifacts } from './pruneExpiredAgentSectionRenderArtifacts';
import { removeAgentProjectSectionArtifacts } from './removeAgentProjectSectionArtifacts';
import { scheduleAgentSectionRenderArtifactExpiry } from './scheduleAgentSectionRenderArtifactExpiry';
import { wouldAgentSectionRenderSetExceedRetention } from './wouldAgentSectionRenderSetExceedRetention';

const PCM_SAMPLE_BYTE_SIZE = Float32Array.BYTES_PER_ELEMENT;

type RenderAgentProjectSectionsInput = {
    jobs: readonly RenderProjectSectionJobSnapshot[];
    retentionProtectedJobIds?: readonly string[];
    sourceRevision: string;
    signal?: AbortSignal;
    validateArtifactAttachment?: () => string | null;
    onRenderAttempt?: (job: RenderProjectSectionJobSnapshot) => void;
    owner?: AgentWorkOwnerIdentity | null;
    onReceipt?: (receipt: AgentRenderReceipt) => void;
    replaceMismatchedRevisionArtifacts?: boolean;
};

function createCancellationError(): Error {
    const error = new Error('Agent section rendering was cancelled');
    error.name = 'AbortError';
    return error;
}

function isCancellationError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

/** Every receipt carries its own copy, so a caller mutating its identity cannot rewrite recorded evidence. */
function ownerCopy(input: RenderAgentProjectSectionsInput): AgentWorkOwnerIdentity | null {
    return cloneAgentWorkOwnerIdentity(input.owner ?? null);
}

function provenanceFor(job: RenderProjectSectionJobSnapshot, sourceRevision: string): AgentRenderProvenance {
    return {
        jobId: job.jobId,
        sectionId: job.sectionId,
        sectionName: job.sectionName,
        startBeat: job.startBeat,
        endBeat: job.endBeat,
        sampleRate: job.sampleRate,
        tailSeconds: job.tailSeconds,
        sourceRevision,
    };
}

function jobGeometryMatches(job: RenderProjectSectionJobSnapshot, artifact: AgentSectionRenderArtifact): boolean {
    return (
        artifact.jobId === job.jobId &&
        artifact.sectionId === job.sectionId &&
        artifact.sectionName === job.sectionName &&
        artifact.startBeat === job.startBeat &&
        artifact.endBeat === job.endBeat &&
        artifact.sampleRate === job.sampleRate &&
        artifact.tailSeconds === job.tailSeconds
    );
}

function jobMatchesArtifact(
    job: RenderProjectSectionJobSnapshot,
    artifact: AgentSectionRenderArtifact,
    sourceRevision: string
): boolean {
    return jobGeometryMatches(job, artifact) && artifact.sourceRevision === sourceRevision;
}

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function artifactAttachmentRefusal(input: RenderAgentProjectSectionsInput): string | null {
    return input.validateArtifactAttachment?.() ?? null;
}

function retainArtifactsForIncoming(
    artifacts: readonly AgentSectionRenderArtifact[],
    incoming: AgentSectionRenderArtifact,
    protectedJobIds: ReadonlySet<string>
): AgentSectionRenderArtifact[] {
    if (incoming.byteSize > AGENT_SECTION_RENDER_RETENTION_POLICY.maxPcmBytes) {
        throw new SectionRenderRetentionCapacityError(
            `Section render artifact byte capacity exceeded: ${String(incoming.byteSize)}/${String(AGENT_SECTION_RENDER_RETENTION_POLICY.maxPcmBytes)}`
        );
    }
    const retained = [...artifacts];
    const evictionCandidates = retained
        .filter((artifact) => !protectedJobIds.has(artifact.jobId))
        .sort((left, right) => left.renderedAt - right.renderedAt || left.jobId.localeCompare(right.jobId));
    let retainedBytes = retained.reduce((total, artifact) => total + artifact.byteSize, 0);
    while (
        retained.length + 1 > AGENT_SECTION_RENDER_RETENTION_POLICY.maxArtifacts ||
        retainedBytes + incoming.byteSize > AGENT_SECTION_RENDER_RETENTION_POLICY.maxPcmBytes
    ) {
        const candidate = evictionCandidates.shift();
        if (!candidate) {
            throw new SectionRenderRetentionCapacityError(
                `Section render artifact retention capacity cannot preserve the current job set: ${String(retained.length + 1)} artifacts, ${String(retainedBytes + incoming.byteSize)} bytes`
            );
        }
        const candidateIndex = retained.findIndex((artifact) => artifact.jobId === candidate.jobId);
        if (candidateIndex >= 0) {
            retained.splice(candidateIndex, 1);
            retainedBytes -= candidate.byteSize;
        }
    }
    return [...retained, incoming];
}

async function runAgentProjectSectionRenders(input: RenderAgentProjectSectionsInput): Promise<void> {
    if (input.signal?.aborted) {
        throw createCancellationError();
    }
    if (input.jobs.length > AGENT_SECTION_RENDER_RETENTION_POLICY.maxArtifacts) {
        const reason = `Section render artifact capacity exceeded: ${String(input.jobs.length)}/${String(AGENT_SECTION_RENDER_RETENTION_POLICY.maxArtifacts)}`;
        throw new SectionRenderFollowUpError({
            failureKind: 'retention-capacity',
            reason,
            remediation: 'manual-repair',
        });
    }
    pruneExpiredAgentSectionRenderArtifacts();
    const initialArtifacts = agentSectionRenderArtifactStore.value?.artifacts ?? [];
    const existingByJobId = new Map(initialArtifacts.map((artifact) => [artifact.jobId, artifact]));
    for (const job of input.jobs) {
        const existing = existingByJobId.get(job.jobId);
        if (existing && !jobGeometryMatches(job, existing)) {
            throw new Error(`Section render job identity is already owned by another artifact: ${job.jobId}`);
        }
    }
    const protectedJobIds = new Set(input.retentionProtectedJobIds ?? input.jobs.map((job) => job.jobId));
    const failures: string[] = [];
    let retentionCapacityFailure = false;
    for (const job of input.jobs) {
        const provenance = provenanceFor(job, input.sourceRevision);
        if (input.signal?.aborted) {
            input.onReceipt?.({ phase: 'cancelled', owner: ownerCopy(input), provenance });
            throw createCancellationError();
        }
        const existing = existingByJobId.get(job.jobId);
        if (existing) {
            if (jobMatchesArtifact(job, existing, input.sourceRevision)) {
                if (existing.warnings.length > 0) {
                    failures.push(`${job.jobId}: ${existing.warnings.join('; ')}`);
                }
                continue;
            }
            if (!input.replaceMismatchedRevisionArtifacts) {
                failures.push(`${job.jobId}: artifact is bound to a different project revision`);
                continue;
            }
            removeAgentProjectSectionArtifacts({ jobs: [job] });
            existingByJobId.delete(job.jobId);
        }

        const warnings: string[] = [];
        try {
            if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(input.sourceRevision)) {
                throw new Error('Project changed during rendering; the artifact was not attached');
            }
        } catch (error) {
            input.onReceipt?.({
                phase: 'failed',
                owner: ownerCopy(input),
                provenance,
                failureKind: 'revision-mismatch',
            });
            failures.push(`${job.jobId}: ${failureReason(error)}`);
            continue;
        }
        const preRenderRefusal = artifactAttachmentRefusal(input);
        if (preRenderRefusal) {
            input.onReceipt?.({
                phase: 'failed',
                owner: ownerCopy(input),
                provenance,
                failureKind: 'attachment-refused',
            });
            throw new Error(preRenderRefusal);
        }
        // Once this job has a terminal receipt, the surrounding catch must not relabel the same
        // failure as a generic render error.
        let jobSettled = false;
        const emitJobSettlement = (receipt: AgentRenderReceipt): void => {
            jobSettled = true;
            input.onReceipt?.(receipt);
        };
        try {
            const cancelActiveRender = () => cancelExport();
            input.signal?.addEventListener('abort', cancelActiveRender, { once: true });
            let buffer: AudioBuffer;
            try {
                input.onRenderAttempt?.(job);
                input.onReceipt?.({ phase: 'started', owner: ownerCopy(input), provenance });
                buffer = await renderOffline({
                    durationBeats: job.endBeat - job.startBeat,
                    startBeat: job.startBeat,
                    sampleRate: job.sampleRate,
                    tailSeconds: job.tailSeconds,
                    onWarning: (warning) => warnings.push(warning),
                });
            } finally {
                input.signal?.removeEventListener('abort', cancelActiveRender);
            }
            // Addressed before the attachment guards below so no await separates the last guard
            // from the store write it protects.
            const contentAddress = await getAudioBufferContentAddress(buffer);
            if (input.signal?.aborted) {
                emitJobSettlement({ phase: 'cancelled', owner: ownerCopy(input), provenance });
                throw createCancellationError();
            }
            if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(input.sourceRevision)) {
                emitJobSettlement({
                    phase: 'failed',
                    owner: ownerCopy(input),
                    provenance,
                    failureKind: 'revision-mismatch',
                });
                throw new Error('Project changed during rendering; the artifact was not attached');
            }
            const attachmentRefusal = artifactAttachmentRefusal(input);
            if (attachmentRefusal) {
                emitJobSettlement({
                    phase: 'failed',
                    owner: ownerCopy(input),
                    provenance,
                    failureKind: 'attachment-refused',
                });
                throw new Error(attachmentRefusal);
            }
            if (buffer.sampleRate !== job.sampleRate || buffer.length <= 0 || buffer.numberOfChannels <= 0) {
                emitJobSettlement({
                    phase: 'failed',
                    owner: ownerCopy(input),
                    provenance,
                    failureKind: 'invalid-buffer',
                });
                throw new Error('Offline renderer returned an invalid section artifact');
            }
            const artifact: AgentSectionRenderArtifact = {
                owner: 'agent-section-render',
                retention: 'session',
                jobId: job.jobId,
                sectionId: job.sectionId,
                sectionName: job.sectionName,
                startBeat: job.startBeat,
                endBeat: job.endBeat,
                sampleRate: job.sampleRate,
                tailSeconds: job.tailSeconds,
                sourceRevision: input.sourceRevision,
                renderedAt: Date.now(),
                durationSeconds: buffer.duration,
                frameCount: buffer.length,
                channelCount: buffer.numberOfChannels,
                byteSize: buffer.length * buffer.numberOfChannels * PCM_SAMPLE_BYTE_SIZE,
                contentAddress,
                warnings: [...warnings],
                buffer,
            };
            const retainedArtifacts = retainArtifactsForIncoming(
                agentSectionRenderArtifactStore.value?.artifacts ?? [],
                artifact,
                protectedJobIds
            );
            agentSectionRenderArtifactStore.set({ artifacts: retainedArtifacts });
            scheduleAgentSectionRenderArtifactExpiry();
            existingByJobId.set(job.jobId, artifact);
            emitJobSettlement({
                phase: 'rendered',
                owner: ownerCopy(input),
                provenance,
                contentAddress: artifact.contentAddress,
                frameCount: artifact.frameCount,
                channelCount: artifact.channelCount,
                renderedAt: artifact.renderedAt,
            });
            if (warnings.length > 0) {
                failures.push(`${job.jobId}: ${warnings.join('; ')}`);
            }
        } catch (error) {
            if (input.signal?.aborted) {
                if (!jobSettled) {
                    emitJobSettlement({ phase: 'cancelled', owner: ownerCopy(input), provenance });
                }
                throw createCancellationError();
            }
            if (!jobSettled) {
                emitJobSettlement({
                    phase: 'failed',
                    owner: ownerCopy(input),
                    provenance,
                    failureKind: 'render-error',
                });
            }
            retentionCapacityFailure ||= error instanceof SectionRenderRetentionCapacityError;
            failures.push(`${job.jobId}: ${failureReason(error)}`);
        }
    }

    if (failures.length > 0) {
        retentionCapacityFailure ||= wouldAgentSectionRenderSetExceedRetention(input.jobs, input.sourceRevision);
        const reason = retentionCapacityFailure
            ? `Section render retention capacity errors require manual repair: ${failures.join('; ')}`
            : `Section render follow-up requires review: ${failures.join('; ')}`;
        const allRequestedArtifactsPresent = input.jobs.every((job) => {
            const artifact = existingByJobId.get(job.jobId);
            return artifact !== undefined && jobMatchesArtifact(job, artifact, input.sourceRevision);
        });
        let failureKind: 'retention-capacity' | 'review-required' | 'render-incomplete' = 'render-incomplete';
        if (retentionCapacityFailure) {
            failureKind = 'retention-capacity';
        } else if (allRequestedArtifactsPresent) {
            failureKind = 'review-required';
        }
        throw new SectionRenderFollowUpError({
            failureKind,
            reason,
            remediation: failureKind === 'render-incomplete' ? 'reconcile' : 'manual-repair',
        });
    }
}

export async function renderAgentProjectSections(input: RenderAgentProjectSectionsInput): Promise<void> {
    let outcome: 'completed' | 'failed' | 'cancelled' = 'completed';
    try {
        await runAgentProjectSectionRenders(input);
    } catch (error) {
        outcome = isCancellationError(error) ? 'cancelled' : 'failed';
        throw error;
    } finally {
        input.onReceipt?.({
            phase: 'batch-settled',
            owner: ownerCopy(input),
            outcome,
            jobIds: input.jobs.map((job) => job.jobId),
        });
    }
}
