type OfflineTempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

type OfflinePpqEndpointProjectionInput = {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
    changes: readonly OfflineTempoChange[];
};

type OfflinePpqEndpointProjection = {
    startSamples: number;
    endSamples: number;
    durationSamples: number;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
};

export type OfflinePpqEndpointProjector = (input: OfflinePpqEndpointProjectionInput) => OfflinePpqEndpointProjection;

export const offlinePpqEndpointProjectorState: {
    project: OfflinePpqEndpointProjector | null;
} = { project: null };
