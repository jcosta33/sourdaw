import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

import { scheduleAgentSectionRenderArtifactExpiry } from './scheduleAgentSectionRenderArtifactExpiry';

type RemoveAgentProjectSectionArtifactsInput = {
    jobs: readonly RenderProjectSectionJobSnapshot[];
};

export function removeAgentProjectSectionArtifacts(input: RemoveAgentProjectSectionArtifactsInput): void {
    const jobIds = new Set(input.jobs.map((job) => job.jobId));
    agentSectionRenderArtifactStore.update((state) => ({
        artifacts: (state?.artifacts ?? []).filter((artifact) => !jobIds.has(artifact.jobId)),
    }));
    scheduleAgentSectionRenderArtifactExpiry();
}
