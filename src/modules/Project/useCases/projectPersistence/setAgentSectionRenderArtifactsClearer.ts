import {
    agentSectionRenderArtifactsClearerRef,
    type AgentSectionRenderArtifactsClearer,
} from './helpers/agentSectionRenderArtifactsClearingState';

/**
 * Register the function that empties AudioRendering's retained agent section
 * renders. See `agentSectionRenderArtifactsClearingState.ts` for why this seam
 * exists instead of a direct cross-module import.
 */
export function setAgentSectionRenderArtifactsClearer(next: AgentSectionRenderArtifactsClearer): void {
    agentSectionRenderArtifactsClearerRef.current = next;
}
