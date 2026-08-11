import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

export function clearAgentSectionRenderArtifacts(): void {
    agentSectionRenderArtifactStore.set({ artifacts: [] });
}
