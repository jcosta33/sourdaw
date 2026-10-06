import { agentMeasurementArtifactStore } from '../stores/agentMeasurementArtifactStore';

import { scheduleAgentMeasurementArtifactExpiry } from './scheduleAgentMeasurementArtifactExpiry';

/**
 * Drops the retained measurement renders held under these content addresses. A measurement that
 * stops after its renders were retained calls this, so a measurement that never reported leaves
 * no artifact behind.
 */
export function discardAgentMeasurementArtifacts(contentAddresses: readonly string[]): void {
    if (contentAddresses.length === 0) {
        return;
    }
    const discarded = new Set(contentAddresses);
    const artifacts = agentMeasurementArtifactStore.value?.artifacts ?? [];
    agentMeasurementArtifactStore.set({
        artifacts: artifacts.filter((artifact) => !discarded.has(artifact.contentAddress)),
    });
    scheduleAgentMeasurementArtifactExpiry();
}
