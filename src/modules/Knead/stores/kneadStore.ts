import { createStore } from '#/infra/store/createStore';

export type NoteBlob = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    pitchCurveCents: number[];
    voicedConfidence: number;
    driftPercent: number;
    vibratoDepthPercent: number;
    vibratoRateHz: number;
    formantShiftCents: number;
    gainDb: number;
    muted: boolean;
};

export type KneadTrackState = {
    trackId: string;
    blobs: NoteBlob[];
    retuneSpeedMs: number;
    toleranceCents: number;
    toleranceTimeMs: number;
    humanizePercent: number;
    formantPreserve: boolean;
};

export type KneadStoreState = {
    activeTrackId: string | null;
    tracks: Record<string, KneadTrackState>;
    isAnalyzing: boolean;
    analysisProgress: number;
};

export const defaultKneadState: KneadStoreState = {
    activeTrackId: null,
    tracks: {},
    isAnalyzing: false,
    analysisProgress: 0,
};

export const kneadStore = createStore<KneadStoreState>({
    initialData: defaultKneadState,
});

export function setActiveKneadTrack(trackId: string | null): void {
    const state = kneadStore.value;
    if (state) {
        kneadStore.set({ ...state, activeTrackId: trackId });
    }
}

export function updateTrackKneadState(trackId: string, updater: (state: KneadTrackState) => KneadTrackState): void {
    const state = kneadStore.value;
    if (!state) {return;}

    const trackState = state.tracks[trackId] ?? {
        trackId,
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };

    kneadStore.set({
        ...state,
        tracks: {
            ...state.tracks,
            [trackId]: updater(trackState),
        },
    });
}
