import { agentMeasurementArtifactStore } from '../stores/agentMeasurementArtifactStore';

import { scheduleAgentMeasurementArtifactExpiry } from './scheduleAgentMeasurementArtifactExpiry';

export function clearAgentMeasurementArtifacts(): void {
    agentMeasurementArtifactStore.set({ artifacts: [] });
    scheduleAgentMeasurementArtifactExpiry();
}
