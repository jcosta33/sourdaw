import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

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
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'knead', {
        // `isAnalyzing` / `analysisProgress` are transient UI flags for an
        // in-flight analysis run. Persisting them lets a mid-analysis crash
        // rehydrate a stuck spinner, so they are stripped before the CRDT write.
        toCrdt: ({ activeClipId, clips, contours }) => ({ activeClipId, clips, contours }),
        // Older documents may still carry the transient flags; force them back
        // to their idle defaults on hydrate so a crashed run never resurfaces.
        fromCrdt: (state) => ({ ...state, isAnalyzing: false, analysisProgress: 0 }),
    }),
    initialData: defaultKneadState,
});
