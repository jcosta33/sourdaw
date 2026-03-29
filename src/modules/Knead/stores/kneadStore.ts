import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type KneadTrackState } from '../models/KneadBlob';

const logger = Container.getInstance().get(Logger);

interface KneadStoreState {
    activeTrackId: string | null;
    tracks: Record<string, KneadTrackState>;
    isAnalyzing: boolean;
    analysisProgress: number;
}

export const kneadStore = new Store<KneadStoreState>(logger, {
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
