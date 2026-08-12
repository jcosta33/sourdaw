import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

export type MidiMappingTargetType = 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam';

/**
 * How a raw 7-bit MIDI value (0–127) is mapped across [minValue, maxValue]:
 * - `linear`: equal increments (correct for pan and most device params).
 * - `log`:    perceptual (audio-pot) taper — slow near the bottom, fast near
 *             the top — appropriate for gain/volume, where a linear fader
 *             feels heavily weighted toward the loud end.
 * - `exp`:    inverse taper — fast near the bottom — for params that need fine
 *             control at the low end.
 */
export type MidiMappingScaleMode = 'linear' | 'log' | 'exp';

export type MidiMapping = {
    id: string;
    channel: number;
    cc: number;
    targetType: MidiMappingTargetType;
    /**
     * Only meaningful for `trackGain`/`trackPan` (which target a specific
     * track's fader) — absent for `fermenterGlobalParam` (routed by device
     * presence, see `handleMidiMessage`) and optional for `deviceParam`.
     * No sentinel value is substituted when a target has no track (F-11).
     */
    trackId?: string;
    deviceId?: string;
    paramId?: string;
    minValue: number;
    maxValue: number;
    /** Curve applied between minValue and maxValue. Absent ⇒ treated as 'linear'. */
    scaleMode?: MidiMappingScaleMode;
};

export type LearningTarget = {
    targetType: MidiMappingTargetType;
    trackId?: string;
    deviceId?: string;
    paramId?: string;
};

export type MidiLearnState = {
    mappings: MidiMapping[];
    isLearning: boolean;
    learningTarget: LearningTarget | null;
};

const VALID_TARGET_TYPES: ReadonlySet<string> = new Set<MidiMappingTargetType>([
    'trackGain',
    'trackPan',
    'deviceParam',
    'fermenterGlobalParam',
]);
const VALID_SCALE_MODES: ReadonlySet<string> = new Set<MidiMappingScaleMode>(['linear', 'log', 'exp']);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidMapping(value: unknown): value is MidiMapping {
    if (!isRecord(value)) {
        return false;
    }
    if (typeof value.id !== 'string') {
        return false;
    }
    if (typeof value.channel !== 'number') {
        return false;
    }
    if (typeof value.cc !== 'number') {
        return false;
    }
    if (typeof value.targetType !== 'string' || !VALID_TARGET_TYPES.has(value.targetType)) {
        return false;
    }
    if (value.trackId !== undefined && typeof value.trackId !== 'string') {
        return false;
    }
    if (value.deviceId !== undefined && typeof value.deviceId !== 'string') {
        return false;
    }
    if (value.paramId !== undefined && typeof value.paramId !== 'string') {
        return false;
    }
    if (typeof value.minValue !== 'number') {
        return false;
    }
    if (typeof value.maxValue !== 'number') {
        return false;
    }
    if (
        value.scaleMode !== undefined &&
        (typeof value.scaleMode !== 'string' || !VALID_SCALE_MODES.has(value.scaleMode))
    ) {
        return false;
    }
    return true;
}

/**
 * Validate content arriving from `localStorage` (F-3).
 *
 * `mappings` are the only durable field — `isLearning`/`learningTarget` are
 * ephemeral UI state and are always reset here so an armed learn from a
 * previous session can never silently survive a reload and capture the next
 * unrelated CC (see F-10's learn timeout for the same invariant in-session).
 */
function sanitizeMidiLearnState(value: unknown): MidiLearnState {
    const mappings = isRecord(value) && Array.isArray(value.mappings) ? value.mappings.filter(isValidMapping) : [];

    return { mappings, isLearning: false, learningTarget: null };
}

const storage = createLocalStorage<MidiLearnState>('sourdaw-midi-learn-mappings');

export const midiLearnStore = createStore<MidiLearnState>({
    storage,
    initialData: {
        mappings: [],
        isLearning: false,
        learningTarget: null,
    },
    sanitize: sanitizeMidiLearnState,
});
