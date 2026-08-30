import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../models/AgentSectionRenderRetentionPolicy';
import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

export function getAgentSectionRenderArtifacts(now = Date.now()) {
    return (agentSectionRenderArtifactStore.value?.artifacts ?? []).filter(
        (artifact) => now - artifact.renderedAt <= AGENT_SECTION_RENDER_RETENTION_POLICY.maxAgeMs
    );
}
