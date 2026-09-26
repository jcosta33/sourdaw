export type AgentMeasurementArtifactsClearer = () => void;

/**
 * The registered clearer, held between the registration use case and
 * `resetModuleStoresToDefault` so each file exports exactly one function.
 * `current` is null until the composition root registers an implementation;
 * see `setAgentMeasurementArtifactsClearer` and `src/app/bootstrap.ts`.
 *
 * The seam exists because `clearAgentMeasurementArtifacts` lives in
 * AudioRendering and importing its barrel from Project is a module cycle —
 * AudioRendering's WAV export path (`exportExactAgentSectionRenderArtifactAsWav`)
 * imports Project's own use cases.
 */
export const agentMeasurementArtifactsClearerRef: { current: AgentMeasurementArtifactsClearer | null } = {
    current: null,
};
