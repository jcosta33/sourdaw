import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

import { scheduleAgentSectionRenderArtifactExpiry } from './scheduleAgentSectionRenderArtifactExpiry';

export function clearAgentSectionRenderArtifacts(): void {
    agentSectionRenderArtifactStore.set({ artifacts: [] });
    scheduleAgentSectionRenderArtifactExpiry();
}
