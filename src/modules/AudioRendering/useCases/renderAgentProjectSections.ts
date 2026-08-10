import { renderOffline } from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { type AgentSectionRenderArtifact } from '../models/AgentSectionRenderArtifact';
import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

const MAX_AGENT_SECTION_RENDER_ARTIFACTS = 16;

type RenderAgentProjectSectionsInput = {
    jobs: readonly RenderProjectSectionJobSnapshot[];
    sourceRevision: string;
};

function jobMatchesArtifact(
    job: RenderProjectSectionJobSnapshot,
    artifact: AgentSectionRenderArtifact,
    sourceRevision: string
): boolean {
    return (
        artifact.jobId === job.jobId &&
        artifact.sectionId === job.sectionId &&
        artifact.sectionName === job.sectionName &&
        artifact.startBeat === job.startBeat &&
        artifact.endBeat === job.endBeat &&
        artifact.sampleRate === job.sampleRate &&
        artifact.tailSeconds === job.tailSeconds &&
        artifact.sourceRevision === sourceRevision
    );
}

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function renderAgentProjectSections(input: RenderAgentProjectSectionsInput): Promise<void> {
    const initialArtifacts = agentSectionRenderArtifactStore.value?.artifacts ?? [];
    const existingByJobId = new Map(initialArtifacts.map((artifact) => [artifact.jobId, artifact]));
    const newJobs = input.jobs.filter((job) => !existingByJobId.has(job.jobId));
    for (const job of input.jobs) {
        const existing = existingByJobId.get(job.jobId);
        if (existing && !jobMatchesArtifact(job, existing, input.sourceRevision)) {
            throw new Error(`Section render job identity is already owned by another artifact: ${job.jobId}`);
        }
    }
    if (initialArtifacts.length + newJobs.length > MAX_AGENT_SECTION_RENDER_ARTIFACTS) {
        throw new Error(
            `Section render artifact capacity exceeded: ${String(initialArtifacts.length + newJobs.length)}/${String(MAX_AGENT_SECTION_RENDER_ARTIFACTS)}`
        );
    }

    const failures: string[] = [];
    for (const job of input.jobs) {
        const existing = existingByJobId.get(job.jobId);
        if (existing) {
            if (existing.warnings.length > 0) {
                failures.push(`${job.jobId}: ${existing.warnings.join('; ')}`);
            }
            continue;
        }

        const warnings: string[] = [];
        try {
            if (captureProjectRevision() !== input.sourceRevision) {
                throw new Error('Project changed during rendering; the artifact was not attached');
            }
            const buffer = await renderOffline({
                durationBeats: job.endBeat - job.startBeat,
                startBeat: job.startBeat,
                sampleRate: job.sampleRate,
                tailSeconds: job.tailSeconds,
                onWarning: (warning) => warnings.push(warning),
            });
            if (captureProjectRevision() !== input.sourceRevision) {
                throw new Error('Project changed during rendering; the artifact was not attached');
            }
            if (buffer.sampleRate !== job.sampleRate || buffer.length <= 0 || buffer.numberOfChannels <= 0) {
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
                warnings: [...warnings],
                buffer,
            };
            agentSectionRenderArtifactStore.update((state) => ({
                artifacts: [...(state?.artifacts ?? []), artifact],
            }));
            existingByJobId.set(job.jobId, artifact);
            if (warnings.length > 0) {
                failures.push(`${job.jobId}: ${warnings.join('; ')}`);
            }
        } catch (error) {
            failures.push(`${job.jobId}: ${failureReason(error)}`);
        }
    }

    if (failures.length > 0) {
        throw new Error(`Section render follow-up requires review: ${failures.join('; ')}`);
    }
}
