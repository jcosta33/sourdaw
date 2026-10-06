import { type GrandBouleMorphState, createDefaultMorphState, findPianoModelById } from './GrandBouleMorphState';
import { type GrandBoulePresetParameters, createNeutralPresetParameters } from './GrandBoulePreset';

export const GRAND_BOULE_DEVICE_STATE_VERSION = 1;

/**
 * Historical temperament index. Matches the Rust enum `Temperament` values.
 * 0 = Equal (default), 1 = Werckmeister III, 2 = Kirnberger III,
 * 3 = Vallotti, 4 = Young II, 5 = Meantone ¼-comma.
 */
export type TemperamentIndex = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * The per-device state that reaches project truth: the morph/layer state plus
 * the tuning and preset voicing a reload and an offline render must restore
 * (#4727). Written and read as one chunk so every audible setting moves
 * through the one undoable `setGrandBouleDeviceState` action.
 */
export type GrandBoulePersistedState = {
    morph: GrandBouleMorphState;
    temperament: TemperamentIndex;
    parameters: GrandBoulePresetParameters;
};

export function createDefaultGrandBoulePersistedState(): GrandBoulePersistedState {
    return {
        morph: createDefaultMorphState(),
        temperament: 0,
        parameters: createNeutralPresetParameters(),
    };
}

type DeviceStateValue = string | number | boolean | null | DeviceStateValue[] | { [key: string]: DeviceStateValue };

export type GrandBouleDeviceStateChunk = {
    version: number;
    data: { [key: string]: DeviceStateValue };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isTemperamentIndex(value: unknown): value is TemperamentIndex {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5;
}

export function toGrandBouleDeviceState(state: GrandBoulePersistedState): GrandBouleDeviceStateChunk {
    return {
        version: GRAND_BOULE_DEVICE_STATE_VERSION,
        data: {
            modelA: state.morph.modelA,
            modelB: state.morph.modelB,
            morphPosition: state.morph.morphPosition,
            layerBalance: state.morph.layerBalance,
            enabled: state.morph.enabled,
            temperament: state.temperament,
            hammerHardness: state.parameters.hammerHardness,
            velocityCurve: state.parameters.velocityCurve,
            stereoWidth: state.parameters.stereoWidth,
            toneTilt: state.parameters.toneTilt,
        },
    };
}

/**
 * Decode a saved chunk, answering `null` for a foreign version or any invalid
 * value so the caller falls back to defaults wholesale.
 *
 * The tuning and voicing leaves may be absent: chunks saved before #4727
 * carried the morph fields only, and those projects sounded Equal temperament
 * with the neutral voicing — which is exactly what the defaults restore. A
 * leaf that is present but out of range is corruption, and rejects the chunk
 * like any other invalid field.
 */
export function fromGrandBouleDeviceState(chunk: unknown): GrandBoulePersistedState | null {
    if (!isRecord(chunk) || chunk.version !== GRAND_BOULE_DEVICE_STATE_VERSION || !isRecord(chunk.data)) {
        return null;
    }
    const { data } = chunk;
    if (data.temperament !== undefined && !isTemperamentIndex(data.temperament)) {
        return null;
    }
    const morph = decodeMorphFields(data);
    const parameters = decodePresetParameters(data);
    if (morph === null || parameters === null) {
        return null;
    }
    return { morph, temperament: data.temperament ?? 0, parameters };
}

/** The five morph leaves as the current models define them, or `null` when any is invalid. */
function decodeMorphFields(data: Record<string, unknown>): GrandBouleMorphState | null {
    const { modelA, modelB, morphPosition, layerBalance, enabled } = data;
    if (
        typeof modelA !== 'string' ||
        typeof modelB !== 'string' ||
        findPianoModelById(modelA) === undefined ||
        findPianoModelById(modelB) === undefined ||
        !finiteInRange(morphPosition, 0, 1) ||
        !finiteInRange(layerBalance, -1, 1) ||
        typeof enabled !== 'boolean'
    ) {
        return null;
    }
    return { modelA, modelB, morphPosition, layerBalance, enabled };
}

/**
 * The four preset-voicing leaves, defaulting to the neutral voicing when
 * absent and rejecting values outside each parameter's declared range.
 */
function decodePresetParameters(data: Record<string, unknown>): GrandBoulePresetParameters | null {
    const savedHammerHardness = data.hammerHardness ?? 0;
    const savedVelocityCurve = data.velocityCurve ?? 1;
    const savedStereoWidth = data.stereoWidth ?? 0.6;
    const savedToneTilt = data.toneTilt ?? 0;
    if (
        !finiteInRange(savedHammerHardness, -1, 1) ||
        !finiteInRange(savedVelocityCurve, 0.5, 2) ||
        !finiteInRange(savedStereoWidth, 0, 1) ||
        !finiteInRange(savedToneTilt, -1, 1)
    ) {
        return null;
    }
    return {
        hammerHardness: savedHammerHardness,
        velocityCurve: savedVelocityCurve,
        stereoWidth: savedStereoWidth,
        toneTilt: savedToneTilt,
    };
}

export function readGrandBouleDeviceState(chunk: unknown): GrandBoulePersistedState {
    return fromGrandBouleDeviceState(chunk) ?? createDefaultGrandBoulePersistedState();
}
