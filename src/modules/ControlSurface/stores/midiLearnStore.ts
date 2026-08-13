import { logger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

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
    /** Bumped whenever `MidiMapping`'s persisted shape changes (audit A-2). */
    mappingsSchemaVersion: number;
    mappings: MidiMapping[];
    isLearning: boolean;
    learningTarget: LearningTarget | null;
};

/**
 * Current `MidiMapping` shape version. A stored/synced value stamped with a
 * newer number than this build knows how to read is refused rather than
 * guessed at (audit A-2) — see `sanitizeMidiLearnState`'s `futureSchemaVersion`
 * branch.
 */
export const MIDI_LEARN_MAPPINGS_SCHEMA_VERSION = 1;

export const defaultMidiLearnState: MidiLearnState = {
    mappingsSchemaVersion: MIDI_LEARN_MAPPINGS_SCHEMA_VERSION,
    mappings: [],
    isLearning: false,
    learningTarget: null,
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

/** `Array.isArray` alone narrows `unknown` to `any[]`, not `unknown[]`. */
function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
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

function isValidMappingsSchemaVersion(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 1;
}

function describeMappingForLog(value: unknown): string {
    if (!isRecord(value)) {
        return String(value);
    }
    const id = typeof value.id === 'string' ? value.id : '<no id>';
    const channel = typeof value.channel === 'number' ? value.channel : '?';
    const cc = typeof value.cc === 'number' ? value.cc : '?';
    return `id=${id} channel=${String(channel)} cc=${String(cc)}`;
}

/**
 * Validate content arriving from the project document — this is
 * project-scoped truth (track/device bindings, audit A-1) shared with
 * collaborators and persisted per project, not a per-install config blob.
 *
 * `mappings` are the only durable field — `isLearning`/`learningTarget` are
 * ephemeral UI state and are always reset here so an armed learn from a
 * previous session can never silently survive a reload/sync and capture the
 * next unrelated CC (see F-10's learn timeout for the same invariant
 * in-session).
 *
 * Every rejection is logged (audit A-2): a stored value that fails validation
 * disappears from the mapping table, and a silent drop gives the user no way
 * to know their bindings were discarded rather than never learned.
 */
export function sanitizeMidiLearnState(value: unknown): MidiLearnState {
    if (!isRecord(value)) {
        if (value !== undefined) {
            logger.warn('Discarding corrupt stored MIDI Learn mappings (not an object); using defaults.', value);
        }
        return { ...defaultMidiLearnState };
    }

    const storedSchemaVersion = value.mappingsSchemaVersion;
    const futureSchemaVersion =
        isValidMappingsSchemaVersion(storedSchemaVersion) && storedSchemaVersion > MIDI_LEARN_MAPPINGS_SCHEMA_VERSION;

    if (futureSchemaVersion) {
        // A newer client wrote a mapping shape this build doesn't understand
        // yet. Refuse to guess at a translation — fall back to an empty table
        // rather than risk misreading fields, but keep the newer version
        // number so this client doesn't stamp it back down to its own.
        logger.warn(
            `Stored MIDI Learn mappings schema version ${String(storedSchemaVersion)} is newer than this build supports (${String(MIDI_LEARN_MAPPINGS_SCHEMA_VERSION)}); ignoring stored mappings.`
        );
        return { ...defaultMidiLearnState, mappingsSchemaVersion: storedSchemaVersion };
    }

    const rawMappings = isUnknownArray(value.mappings) ? value.mappings : [];
    const mappings = rawMappings.filter(isValidMapping);
    const rejected = rawMappings.filter((mapping) => !isValidMapping(mapping));

    if (rejected.length > 0) {
        logger.warn(
            `Discarding ${String(rejected.length)} invalid MIDI Learn mapping(s): ${rejected.map(describeMappingForLog).join('; ')}`
        );
    }

    return {
        mappingsSchemaVersion: MIDI_LEARN_MAPPINGS_SCHEMA_VERSION,
        mappings,
        isLearning: false,
        learningTarget: null,
    };
}

export const midiLearnStore = createStore<MidiLearnState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'midiLearn', {
        fromCrdt: sanitizeMidiLearnState,
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultMidiLearnState,
        toCrdt: ({ mappingsSchemaVersion, mappings }) => ({ mappingsSchemaVersion, mappings }),
    }),
    initialData: defaultMidiLearnState,
    sanitize: sanitizeMidiLearnState,
});
