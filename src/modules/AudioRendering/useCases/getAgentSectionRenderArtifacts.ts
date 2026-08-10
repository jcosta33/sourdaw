import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

export function getAgentSectionRenderArtifacts() {
    return [...(agentSectionRenderArtifactStore.value?.artifacts ?? [])];
}
