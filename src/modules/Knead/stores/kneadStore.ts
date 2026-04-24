import { createStore } from '#/infra/store/createStore';

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
