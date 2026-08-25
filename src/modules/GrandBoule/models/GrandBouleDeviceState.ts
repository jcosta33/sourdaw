import { type GrandBouleMorphState, createDefaultMorphState, findPianoModelById } from './GrandBouleMorphState';

export const GRAND_BOULE_DEVICE_STATE_VERSION = 1;

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

export function toGrandBouleDeviceState(morph: GrandBouleMorphState): GrandBouleDeviceStateChunk {
    return {
        version: GRAND_BOULE_DEVICE_STATE_VERSION,
        data: {
            modelA: morph.modelA,
            modelB: morph.modelB,
            morphPosition: morph.morphPosition,
            layerBalance: morph.layerBalance,
            enabled: morph.enabled,
        },
    };
}

export function fromGrandBouleDeviceState(chunk: unknown): GrandBouleMorphState | null {
    if (!isRecord(chunk) || chunk.version !== GRAND_BOULE_DEVICE_STATE_VERSION || !isRecord(chunk.data)) {
        return null;
    }
    const { modelA, modelB, morphPosition, layerBalance, enabled } = chunk.data;
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

export function readGrandBouleMorphState(chunk: unknown): GrandBouleMorphState {
    return fromGrandBouleDeviceState(chunk) ?? createDefaultMorphState();
}
