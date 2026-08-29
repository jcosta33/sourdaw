import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../models/AgentSectionRenderRetentionPolicy';
import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

import { pruneExpiredAgentSectionRenderArtifacts } from './pruneExpiredAgentSectionRenderArtifacts';

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAgentSectionRenderArtifactExpiry(now = Date.now()): void {
    if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
    }
    const artifacts = agentSectionRenderArtifactStore.value?.artifacts ?? [];
    if (artifacts.length === 0) {
        return;
    }
    const earliestExpiry = Math.min(
        ...artifacts.map((artifact) => artifact.renderedAt + AGENT_SECTION_RENDER_RETENTION_POLICY.maxAgeMs + 1)
    );
    expiryTimer = setTimeout(
        () => {
            expiryTimer = null;
            pruneExpiredAgentSectionRenderArtifacts();
            scheduleAgentSectionRenderArtifactExpiry();
        },
        Math.max(0, earliestExpiry - now)
    );
    if (typeof expiryTimer === 'object') {
        expiryTimer.unref();
    }
}
