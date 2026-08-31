import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { type AgentSectionRenderArtifact } from '../models/AgentSectionRenderArtifact';
import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../models/AgentSectionRenderRetentionPolicy';
import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

function hasComparableGeometry(job: RenderProjectSectionJobSnapshot, artifact: AgentSectionRenderArtifact): boolean {
    return (
        artifact.sampleRate === job.sampleRate &&
        artifact.endBeat - artifact.startBeat === job.endBeat - job.startBeat &&
        artifact.tailSeconds === job.tailSeconds
    );
}

export function wouldAgentSectionRenderSetExceedRetention(jobs: readonly RenderProjectSectionJobSnapshot[]): boolean {
    if (jobs.length > AGENT_SECTION_RENDER_RETENTION_POLICY.maxArtifacts) {
        return true;
    }
    const retainedArtifacts = agentSectionRenderArtifactStore.value?.artifacts ?? [];
    let estimatedBytes = 0;
    for (const job of jobs) {
        const exactArtifact = retainedArtifacts.find(({ jobId }) => jobId === job.jobId);
        const comparableArtifact =
            exactArtifact ?? retainedArtifacts.find((artifact) => hasComparableGeometry(job, artifact));
        if (!comparableArtifact) {
            return false;
        }
        estimatedBytes += comparableArtifact.byteSize;
    }
    return estimatedBytes > AGENT_SECTION_RENDER_RETENTION_POLICY.maxPcmBytes;
}
