import { AGENT_MEASUREMENT_RETENTION_POLICY } from '../models/AgentMeasurementRetentionPolicy';
import { agentMeasurementArtifactStore } from '../stores/agentMeasurementArtifactStore';

import { pruneExpiredAgentMeasurementArtifacts } from './pruneExpiredAgentMeasurementArtifacts';

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAgentMeasurementArtifactExpiry(now = Date.now()): void {
    if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
    }
    const artifacts = agentMeasurementArtifactStore.value?.artifacts ?? [];
    if (artifacts.length === 0) {
        return;
    }
    const earliestExpiry = Math.min(
        ...artifacts.map((artifact) => artifact.renderedAt + AGENT_MEASUREMENT_RETENTION_POLICY.maxAgeMs + 1)
    );
    expiryTimer = setTimeout(
        () => {
            expiryTimer = null;
            pruneExpiredAgentMeasurementArtifacts();
            scheduleAgentMeasurementArtifactExpiry();
        },
        Math.max(0, earliestExpiry - now)
    );
    if (typeof expiryTimer === 'object') {
        expiryTimer.unref();
    }
}
