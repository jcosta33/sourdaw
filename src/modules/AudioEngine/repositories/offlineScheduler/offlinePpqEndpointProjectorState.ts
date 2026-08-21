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

type OfflineTempoAtBeatInput = {
    changes: readonly OfflineTempoChange[];
    beat: number;
    defaultTempo: number;
};

export type OfflinePpqEndpointProjector = (input: OfflinePpqEndpointProjectionInput) => OfflinePpqEndpointProjection;

/**
 * The flat tempo governing a beat, as opposed to the integrated map
 * `OfflinePpqEndpointProjector` walks.
 *
 * The two answer different questions and the offline render needs both: a
 * timeline placement integrates every change in the span, while a
 * buffer-*content* offset stays on the single rate the material was recorded
 * at — the law `scheduleAudioClips` states and follows live.
 */
export type OfflineTempoAtBeatResolver = (input: OfflineTempoAtBeatInput) => number;

export const offlinePpqEndpointProjectorState: {
    project: OfflinePpqEndpointProjector | null;
    resolveTempoAtBeat: OfflineTempoAtBeatResolver | null;
} = { project: null, resolveTempoAtBeat: null };
