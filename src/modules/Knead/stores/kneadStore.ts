import { createStore } from '#/infra/store/createStore';
import { type KneadTrackState } from '../models/KneadBlob';

interface KneadStoreState {
    activeTrackId: string | null;
    tracks: Record<string, KneadTrackState>;
    isAnalyzing: boolean;
    analysisProgress: number;
}

export const kneadStore = createStore<KneadStoreState>({
    initialData: {
        activeTrackId: null,
        tracks: {},
        isAnalyzing: false,
        analysisProgress: 0,
    },
});

export function setActiveKneadTrack(trackId: string | null): void {
    const state = kneadStore.value;
    if (state) {
        kneadStore.set({ ...state, activeTrackId: trackId });
    }
}

export function updateTrackKneadState(trackId: string, updater: (state: KneadTrackState) => KneadTrackState): void {
    const state = kneadStore.value;
    if (!state) return;

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
