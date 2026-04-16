import { createStore } from '#/infra/store/createStore';
import { updateClip } from '#/modules/Arrangement/useCases';

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

export type KneadClipState = {
    clipId: string;
    blobs: NoteBlob[];
    retuneSpeedMs: number;
    toleranceCents: number;
    toleranceTimeMs: number;
    humanizePercent: number;
    formantPreserve: boolean;
};

export type KneadStoreState = {
    activeClipId: string | null;
    clips: Record<string, KneadClipState>;
    isAnalyzing: boolean;
    analysisProgress: number;
};

export const defaultKneadState: KneadStoreState = {
    activeClipId: null,
    clips: {},
    isAnalyzing: false,
    analysisProgress: 0,
};

export const kneadStore = createStore<KneadStoreState>({
    initialData: defaultKneadState,
});

export function setActiveKneadClip(clipId: string | null): void {
    const state = kneadStore.value;
    if (state) {
        kneadStore.set({ ...state, activeClipId: clipId });
    }
}

export function updateClipKneadState(clipId: string, updater: (state: KneadClipState) => KneadClipState): void {
    const state = kneadStore.value;
    if (!state) {return;}

    const clipState = state.clips[clipId] ?? {
        clipId,
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };

    const nextKneadState = updater(clipState);

    // 1. Update local kneadStore (for fast UI reactivity)
    kneadStore.set({
        ...state,
        clips: {
            ...state.clips,
            [clipId]: nextKneadState,
        },
    });

    // 2. Persist to trackStore / Automerge
    updateClip(clipId, (clip) => ({
        ...clip,
        kneadState: nextKneadState,
    }));
}
