import { AGENT_MEASUREMENT_RETENTION_POLICY } from '../models/AgentMeasurementRetentionPolicy';
import { agentMeasurementArtifactStore } from '../stores/agentMeasurementArtifactStore';

export function pruneExpiredAgentMeasurementArtifacts(now = Date.now()): void {
    agentMeasurementArtifactStore.update((state) => ({
        artifacts: (state?.artifacts ?? []).filter(
            (artifact) => now - artifact.renderedAt <= AGENT_MEASUREMENT_RETENTION_POLICY.maxAgeMs
        ),
    }));
}
