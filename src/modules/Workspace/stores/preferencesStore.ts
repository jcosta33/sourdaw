import { logger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import {
    BUFFER_SIZE_OPTIONS,
    GRID_SNAP_OPTIONS,
    SAMPLE_RATE_OPTIONS,
    defaultPreferences,
    type Preferences,
} from '../models/Preferences';

// Re-export the public preferences type alongside the store that holds it. The
// `useCases/` contract barrel must not re-export types (arch rule
// `no-usecase-type-exports-on-index`), so the cross-module type surface lives on
// the `stores/` barrel next to `preferencesStore`.
export type { Preferences };

const storage = createLocalStorage<Preferences>('sourdaw-preferences');

const GRID_SNAP_VALUES = new Set<unknown>(GRID_SNAP_OPTIONS.map((option) => option.value));
const BUFFER_SIZE_VALUES = new Set<unknown>(BUFFER_SIZE_OPTIONS.map((option) => option.value));
const SAMPLE_RATE_VALUES = new Set<unknown>(SAMPLE_RATE_OPTIONS.map((option) => option.value));

function isFiniteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function isOneOf(...allowed: unknown[]): (value: unknown) => boolean {
    return (value: unknown): boolean => allowed.includes(value);
}

/**
 * Per-field runtime guards for the persisted preferences blob. A stored value is
 * accepted only when its guard passes; anything else (missing, wrong type, corrupt
 * enum, e.g. `theme: null`) is replaced by the canonical default. New keys absent
 * from storage fall through to defaults too.
 */
const PREFERENCES_SCHEMA: { [K in keyof Preferences]: (value: unknown) => boolean } = {
    trackHeight: isOneOf('compact', 'normal', 'large'),
    colorblindMode: (value) => typeof value === 'boolean',
    autoSave: (value) => typeof value === 'boolean',
    autoSaveIntervalMs: isFiniteNumber,
    snapToGrid: (value) => typeof value === 'boolean',
    snapToZeroCrossing: (value) => typeof value === 'boolean',
    gridSubdivision: (value) => GRID_SNAP_VALUES.has(value),
    showMinimap: (value) => typeof value === 'boolean',
    voiceCommandKey: (value) => typeof value === 'string',
    theme: isOneOf('dark', 'light'),
    uiScale: isFiniteNumber,
    panelPlacementSidebar: isOneOf('left', 'right'),
    panelPlacementInspector: isOneOf('left', 'right'),
    panelPlacementChat: isOneOf('left', 'right'),
    panelPlacementAi: isOneOf('left', 'right'),
    bufferSize: (value) => BUFFER_SIZE_VALUES.has(value),
    sampleRate: (value) => SAMPLE_RATE_VALUES.has(value),
    metronomeEnabled: (value) => typeof value === 'boolean',
    metronomeVolume: isFiniteNumber,
    recordCountIn: isOneOf(0, 1, 2, 4),
    defaultVelocity: isFiniteNumber,
    midiInputChannel: (value) => value === 'all' || isFiniteNumber(value),
    soloMode: isOneOf('sip', 'afl', 'pfl'),
    preRollEnabled: (value) => typeof value === 'boolean',
    preRollBars: isOneOf(1, 2, 4),
};

const PREFERENCE_KEYS = Object.keys(PREFERENCES_SCHEMA) as (keyof Preferences)[];

/**
 * Validate a raw persisted value against the schema, field by field. Returns a
 * complete Preferences object: every valid stored field is preserved, every
 * invalid or missing field falls back to its default. Rejected fields are logged.
 */
export function validateStoredPreferences(stored: unknown): Preferences {
    if (stored === null || typeof stored !== 'object') {
        if (stored !== null) {
            logger.warn('Discarding corrupt stored preferences (not an object); using defaults.', stored);
        }
        return defaultPreferences;
    }

    const record = stored as Record<string, unknown>;
    const result = { ...defaultPreferences };
    const rejected: string[] = [];

    for (const key of PREFERENCE_KEYS) {
        if (!(key in record)) {
            continue;
        }
        const value = record[key];
        if (PREFERENCES_SCHEMA[key](value)) {
            // The guard has narrowed this value to the field's type at runtime.
            (result as Record<string, unknown>)[key] = value;
        } else {
            rejected.push(key);
        }
    }

    if (rejected.length > 0) {
        logger.warn(`Discarding invalid stored preference field(s): ${rejected.join(', ')}; using defaults for those.`);
    }

    return result;
}

// Validate stored data against the schema so new keys are present and corrupt
// values (e.g. `theme: null`) never leak into consumers.
//
// `createStore` only writes `initialData` when storage is empty, so a sanitized
// `initialData` derived from a *present* corrupt blob would be discarded and
// `store.value` would return the raw corrupt blob. To keep the documented
// guarantee at the read boundary, write the validated form back through the
// storage adapter here whenever it differs from what is stored — this covers the
// present-but-corrupt-blob case as well as schema migration (new keys filled
// with defaults). When storage is empty the write seeds the defaults, matching
// the previous behavior.
function loadPreferences(): Preferences {
    const raw = storage.get();
    const validated = validateStoredPreferences(raw);
    if (raw === null || JSON.stringify(raw) !== JSON.stringify(validated)) {
        storage.set(validated);
    }
    return validated;
}

export const preferencesStore = createStore<Preferences>({
    storage,
    initialData: loadPreferences(),
});
