import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../models/AgentSectionRenderRetentionPolicy';
import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

export function pruneExpiredAgentSectionRenderArtifacts(now = Date.now()): void {
    agentSectionRenderArtifactStore.update((state) => ({
        artifacts: (state?.artifacts ?? []).filter(
            (artifact) => now - artifact.renderedAt <= AGENT_SECTION_RENDER_RETENTION_POLICY.maxAgeMs
        ),
    }));
}
