import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

type UnknownRecord = {
    readonly [key: string]: unknown;
};

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

function create_default_knead_state(): KneadStoreState {
    return {
        activeClipId: null,
        clips: {},
        contours: {},
        isAnalyzing: false,
        analysisProgress: 0,
    };
}

function is_unknown_record(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function sanitize_active_clip_id(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }

    return null;
}

function sanitize_number_array(value: unknown): number[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const numbers: number[] = [];
    for (const item of value) {
        if (!is_finite_number(item)) {
            return null;
        }
        numbers.push(item);
    }

    return numbers;
}

function sanitize_note_blob(value: unknown): NoteBlob | null {
    if (!is_unknown_record(value)) {
        return null;
    }

    const pitch_curve_cents = sanitize_number_array(value.pitchCurveCents);
    if (pitch_curve_cents === null) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        !is_finite_number(value.startTime) ||
        !is_finite_number(value.endTime) ||
        !is_finite_number(value.pitchCenterCents) ||
        !is_finite_number(value.originalPitchCenterCents) ||
        !is_finite_number(value.voicedConfidence) ||
        !is_finite_number(value.driftPercent) ||
        !is_finite_number(value.vibratoDepthPercent) ||
        !is_finite_number(value.vibratoRateHz) ||
        !is_finite_number(value.formantShiftCents) ||
        !is_finite_number(value.gainDb) ||
        typeof value.muted !== 'boolean'
    ) {
        return null;
    }

    return {
        id: value.id,
        startTime: value.startTime,
        endTime: value.endTime,
        pitchCenterCents: value.pitchCenterCents,
        originalPitchCenterCents: value.originalPitchCenterCents,
        pitchCurveCents: pitch_curve_cents,
        voicedConfidence: value.voicedConfidence,
        driftPercent: value.driftPercent,
        vibratoDepthPercent: value.vibratoDepthPercent,
        vibratoRateHz: value.vibratoRateHz,
        formantShiftCents: value.formantShiftCents,
        gainDb: value.gainDb,
        muted: value.muted,
    };
}

function sanitize_note_blobs(value: unknown): NoteBlob[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const blobs: NoteBlob[] = [];
    for (const item of value) {
        const blob = sanitize_note_blob(item);
        if (blob !== null) {
            blobs.push(blob);
        }
    }

    return blobs;
}

function sanitize_knead_clip_state(value: unknown): KneadClipState | null {
    if (!is_unknown_record(value)) {
        return null;
    }

    const blobs = sanitize_note_blobs(value.blobs);
    if (blobs === null) {
        return null;
    }

    if (
        typeof value.clipId !== 'string' ||
        !is_finite_number(value.retuneSpeedMs) ||
        !is_finite_number(value.toleranceCents) ||
        !is_finite_number(value.toleranceTimeMs) ||
        !is_finite_number(value.humanizePercent) ||
        typeof value.formantPreserve !== 'boolean'
    ) {
        return null;
    }

    return {
        clipId: value.clipId,
        blobs,
        retuneSpeedMs: value.retuneSpeedMs,
        toleranceCents: value.toleranceCents,
        toleranceTimeMs: value.toleranceTimeMs,
        humanizePercent: value.humanizePercent,
        formantPreserve: value.formantPreserve,
    };
}

function sanitize_knead_clip_map(value: unknown): Record<string, KneadClipState> {
    const clips: Record<string, KneadClipState> = {};
    if (!is_unknown_record(value)) {
        return clips;
    }

    for (const [clip_id, clip_candidate] of Object.entries(value)) {
        const clip = sanitize_knead_clip_state(clip_candidate);
        if (clip !== null) {
            clips[clip_id] = clip;
        }
    }

    return clips;
}

function sanitize_pitch_point(value: unknown): PitchPoint | null {
    if (!is_unknown_record(value)) {
        return null;
    }

    if (
        !is_finite_number(value.time_ms) ||
        !is_finite_number(value.frequency_hz) ||
        !is_finite_number(value.confidence) ||
        typeof value.voiced !== 'boolean'
    ) {
        return null;
    }

    return {
        time_ms: value.time_ms,
        frequency_hz: value.frequency_hz,
        confidence: value.confidence,
        voiced: value.voiced,
    };
}

function sanitize_pitch_points(value: unknown): PitchPoint[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const points: PitchPoint[] = [];
    for (const item of value) {
        const point = sanitize_pitch_point(item);
        if (point !== null) {
            points.push(point);
        }
    }

    return points;
}

function sanitize_pitch_contour(value: unknown): PitchContour | null {
    if (!is_unknown_record(value)) {
        return null;
    }

    const points = sanitize_pitch_points(value.points);
    if (points === null) {
        return null;
    }

    if (!is_finite_number(value.sample_rate) || !is_finite_number(value.hop_size)) {
        return null;
    }

    if (typeof value.algorithm === 'string') {
        return {
            points,
            sample_rate: value.sample_rate,
            hop_size: value.hop_size,
            algorithm: value.algorithm,
        };
    }

    return {
        points,
        sample_rate: value.sample_rate,
        hop_size: value.hop_size,
    };
}

function sanitize_pitch_contour_map(value: unknown): Record<string, PitchContour> {
    const contours: Record<string, PitchContour> = {};
    if (!is_unknown_record(value)) {
        return contours;
    }

    for (const [clip_id, contour_candidate] of Object.entries(value)) {
        const contour = sanitize_pitch_contour(contour_candidate);
        if (contour !== null) {
            contours[clip_id] = contour;
        }
    }

    return contours;
}

function sanitize_crdt_knead_state(value: unknown): KneadStoreState {
    if (!is_unknown_record(value)) {
        return create_default_knead_state();
    }

    return {
        activeClipId: sanitize_active_clip_id(value.activeClipId),
        clips: sanitize_knead_clip_map(value.clips),
        contours: sanitize_pitch_contour_map(value.contours),
        isAnalyzing: false,
        analysisProgress: 0,
    };
}

export const kneadStore = createStore<KneadStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'knead', {
        // `isAnalyzing` / `analysisProgress` are transient UI flags for an
        // in-flight analysis run. Persisting them lets a mid-analysis crash
        // rehydrate a stuck spinner, so they are stripped before the CRDT write.
        toCrdt: ({ activeClipId, clips, contours }) => ({ activeClipId, clips, contours }),
        // Older documents may still carry the transient flags; force them back
        // to their idle defaults on hydrate so a crashed run never resurfaces.
        fromCrdt: (state) => sanitize_crdt_knead_state(state),
    }),
    initialData: defaultKneadState,
});
