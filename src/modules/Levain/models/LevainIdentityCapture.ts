import { isRecord } from '#/utils/structuralEquality';

import { LEVAIN_DEVICE_STATE_VERSION } from './LevainDeviceState';
import { createDefaultPatch, DEFAULT_LEVAIN_INSTRUMENT_ID, isArticulationType, isInstrumentId } from './LevainPatch';

function isJsonValue(value: unknown, depth = 0): boolean {
    if (depth > 64) {
        return false;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return Array.from(value).every((item) => isJsonValue(item, depth + 1));
    }
    return (
        isRecord(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
        Object.values(value).every((item) => isJsonValue(item, depth + 1))
    );
}

function readIdentityData(data: Record<string, unknown>) {
    const { instrumentId, currentArticulation, ...unowned } = data;
    if (!isInstrumentId(instrumentId)) {
        return null;
    }
    const patch = createDefaultPatch(instrumentId);
    const articulation = patch.articulations.find(({ type }) => type === currentArticulation);
    // A merge can combine two known values from different banks. Preserve its raw
    // articulation for Undo while presenting the same fallback as the live decoder.
    if (Object.hasOwn(data, 'currentArticulation') && !isArticulationType(currentArticulation)) {
        return null;
    }
    if (Object.hasOwn(data, 'disclosureTier') && data.disclosureTier !== 'basic' && data.disclosureTier !== 'expert') {
        return null;
    }
    return {
        instrumentId: patch.instrumentId,
        articulation: articulation?.type ?? patch.currentArticulation,
        bankArticulation: articulation?.type,
        unowned,
    };
}

/** Read the exact saved identity without substituting for unsupported or invalid fields. */
export function readLevainIdentityCapture(chunk: unknown) {
    if (chunk === null) {
        return readIdentityData({ instrumentId: DEFAULT_LEVAIN_INSTRUMENT_ID });
    }
    if (
        !isRecord(chunk) ||
        Object.keys(chunk).length !== 2 ||
        chunk.version !== LEVAIN_DEVICE_STATE_VERSION ||
        !isRecord(chunk.data) ||
        !isJsonValue(chunk.data)
    ) {
        return null;
    }
    return readIdentityData(chunk.data);
}
