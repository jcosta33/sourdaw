type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

type PpqEndpointProjectionInput = {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
    changes: readonly TempoChange[];
};

type PpqEndpointProjection = {
    startSamples: number;
    endSamples: number;
    durationSamples: number;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
};

type OfflineRenderDependencies = {
    projectPpqEndpoints: (input: PpqEndpointProjectionInput) => PpqEndpointProjection;
};

export let offlineRenderDependencies: OfflineRenderDependencies | null = null;

export function setOfflineRenderDependencies(dependencies: OfflineRenderDependencies | null): void {
    offlineRenderDependencies = dependencies;
}
