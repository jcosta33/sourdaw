import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

import { getExactAgentSectionRenderArtifact } from './getExactAgentSectionRenderArtifact';
import { scheduleAgentSectionRenderArtifactExpiry } from './scheduleAgentSectionRenderArtifactExpiry';

type ExactArtifactBinding = { job: RenderProjectSectionJobSnapshot; sourceRevision: string };

/** Removes precisely one still-current retained buffer; mismatches are never broadened into a cleanup. */
export function disposeExactAgentSectionRenderArtifact(binding: ExactArtifactBinding): boolean {
    const artifact = getExactAgentSectionRenderArtifact(binding);
    if (!artifact) {
        return false;
    }
    const artifacts = agentSectionRenderArtifactStore.value?.artifacts ?? [];
    agentSectionRenderArtifactStore.set({ artifacts: artifacts.filter((candidate) => candidate !== artifact) });
    scheduleAgentSectionRenderArtifactExpiry();
    return true;
}
