import { createStore } from '#/infra/store/createStore';
import { updateClip } from '#/modules/Arrangement/useCases';

export type NoteBlob = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    originalPitchCenterCents: number;
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

export type PitchPoint = {
    time_ms: number;
    frequency_hz: number;
    confidence: number;
    voiced: boolean;
};

export type PitchContour = {
    points: PitchPoint[];
    sample_rate: number;
    hop_size: number;
    algorithm?: string;
};

export type KneadStoreState = {
    activeClipId: string | null;
    clips: Record<string, KneadClipState>;
    contours: Record<string, PitchContour>;
    isAnalyzing: boolean;
    analysisProgress: number;
};

export const defaultKneadState: KneadStoreState = {
    activeClipId: null,
    clips: {},
    contours: {},
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
    if (!state) {
        return;
    }

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
