import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

import { pruneExpiredAgentSectionRenderArtifacts } from './pruneExpiredAgentSectionRenderArtifacts';

export function getAgentSectionRenderArtifacts() {
    pruneExpiredAgentSectionRenderArtifacts();
    return [...(agentSectionRenderArtifactStore.value?.artifacts ?? [])];
}
