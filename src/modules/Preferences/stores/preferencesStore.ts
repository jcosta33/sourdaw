import { logger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
import { normalizeTimelineMinimapHeight } from '#/utils/TimelineMinimap/timelineMinimapHeight';

import {
    AUDIO_LATENCY_PROFILE_OPTIONS,
    GRID_SNAP_OPTIONS,
    PREFERENCES_SCHEMA_VERSION,
    defaultPreferences,
    isAutoSaveIntervalMs,
    type Preferences,
} from '../models/Preferences';

// Re-export the public preferences type alongside the store that holds it. The
// `useCases/` contract barrel must not re-export types (arch rule
// `no-usecase-type-exports-on-index`), so the cross-module type surface lives on
// the `stores/` barrel next to `preferencesStore`.
export type { Preferences };

const storage = createLocalStorage<Preferences>('sourdaw-preferences');

const GRID_SNAP_VALUES = new Set<unknown>(GRID_SNAP_OPTIONS.map((option) => option.value));
const AUDIO_LATENCY_PROFILE_VALUES = new Set<unknown>(AUDIO_LATENCY_PROFILE_OPTIONS.map((option) => option.value));

function isFiniteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function isValidPreferencesSchemaVersion(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 1;
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
    preferencesSchemaVersion: isValidPreferencesSchemaVersion,
    trackHeight: isOneOf('compact', 'normal', 'large'),
    colorblindMode: (value) => typeof value === 'boolean',
    autoSave: (value) => typeof value === 'boolean',
    autoSaveIntervalMs: isAutoSaveIntervalMs,
    snapToGrid: (value) => typeof value === 'boolean',
    snapToZeroCrossing: (value) => typeof value === 'boolean',
    gridSubdivision: (value) => GRID_SNAP_VALUES.has(value),
    showMinimap: (value) => typeof value === 'boolean',
    timelineMinimapHeight: isFiniteNumber,
    voiceCommandKey: (value) => typeof value === 'string',
    theme: isOneOf('dark', 'light'),
    uiScale: isFiniteNumber,
    panelPlacementSidebar: isOneOf('left', 'right'),
    panelPlacementInspector: isOneOf('left', 'right'),
    panelPlacementChat: isOneOf('left', 'right'),
    panelPlacementAi: isOneOf('left', 'right'),
    audioLatencyProfile: (value) => AUDIO_LATENCY_PROFILE_VALUES.has(value),
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
    const storedSchemaVersion = record.preferencesSchemaVersion;
    const futureSchemaVersion =
        isValidPreferencesSchemaVersion(storedSchemaVersion) && storedSchemaVersion > PREFERENCES_SCHEMA_VERSION;
    let result: Preferences & Record<string, unknown> = { ...defaultPreferences };
    if (futureSchemaVersion) {
        result = { ...record, ...defaultPreferences };
    }
    const rejected: string[] = [];
    const visibilityChoiceIsAuthoritative = isValidPreferencesSchemaVersion(storedSchemaVersion);

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

    result.timelineMinimapHeight = normalizeTimelineMinimapHeight(result.timelineMinimapHeight);
    if (!futureSchemaVersion) {
        result.preferencesSchemaVersion = PREFERENCES_SCHEMA_VERSION;
    }
    if (!visibilityChoiceIsAuthoritative) {
        result.showMinimap = true;
    }

    if (rejected.length > 0) {
        logger.warn(`Discarding invalid stored preference field(s): ${rejected.join(', ')}; using defaults for those.`);
    }

    return result;
}

export const preferencesStore = createStore<Preferences>({
    storage,
    initialData: defaultPreferences,
    sanitize: validateStoredPreferences,
});
