import { AGENT_MEASUREMENT_RETENTION_POLICY } from '../models/AgentMeasurementRetentionPolicy';
import { agentMeasurementArtifactStore } from '../stores/agentMeasurementArtifactStore';

/** Every retained measurement render still inside its age limit, oldest first. */
export function getAgentMeasurementArtifacts(now = Date.now()) {
    return (agentMeasurementArtifactStore.value?.artifacts ?? []).filter(
        (artifact) => now - artifact.renderedAt <= AGENT_MEASUREMENT_RETENTION_POLICY.maxAgeMs
    );
}
