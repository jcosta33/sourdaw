import {
    agentMeasurementArtifactsClearerRef,
    type AgentMeasurementArtifactsClearer,
} from './helpers/agentMeasurementArtifactClearingState';

/**
 * Register the function that empties AudioRendering's retained agent
 * measurement renders. See `agentMeasurementArtifactClearingState.ts` for why
 * this seam exists instead of a direct cross-module import.
 */
export function setAgentMeasurementArtifactsClearer(next: AgentMeasurementArtifactsClearer): void {
    agentMeasurementArtifactsClearerRef.current = next;
}
