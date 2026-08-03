import {
    createDefaultPatch,
    isInstrumentId,
    type ArticulationType,
    type InstrumentId,
    type LevainPatch,
} from './LevainPatch';

/**
 * Wire version of the Levain device-state chunk. **Never renamed, never reused.**
 * Bump it only when the payload shape changes in a way an older reader would
 * misread; a reader that does not recognise the version falls back to the default
 * patch rather than guessing at the fields.
 *
 * Distinct from `LevainPatch.version`, which describes a patch's own contents —
 * this one describes the envelope the document stores it in.
 */
export const LEVAIN_DEVICE_STATE_VERSION = 1;

/**
 * JSON-shaped payload the document can store and merge. Mirrors the Arrangement
 * `DeviceStateValue` model structurally rather than importing it — models do not
 * cross module boundaries, and the chunk is opaque to the host by design.
 */
type LevainDeviceStateValue =
    string | number | boolean | null | LevainDeviceStateValue[] | { [key: string]: LevainDeviceStateValue };

type LevainDeviceStateChunk = {
    version: number;
    data: { [key: string]: LevainDeviceStateValue };
};

/**
 * The part of a Levain patch that selects *which instrument this is*.
 *
 * Everything else in the patch is numbers, and numbers already round-trip:
 * `persistDevicePatch` writes them into `Device.parameterValues`, which is also
 * the automation surface. These two are strings, so that path drops them
 * silently — which is why a reopened orchestral project played violin-1 on every
 * track regardless of what was saved.
 */
export type LevainPatchIdentity = {
    instrumentId: InstrumentId;
    currentArticulation: ArticulationType;
};

/** Serialise a live patch's identity into the device-state chunk the document stores. */
export function toLevainDeviceState(patch: LevainPatch): LevainDeviceStateChunk {
    return {
        version: LEVAIN_DEVICE_STATE_VERSION,
        // Structured, not stringified: the document merges the subtree field by
        // field, so a peer changing the articulation does not clobber a peer
        // changing the instrument.
        data: {
            instrumentId: patch.instrumentId,
            currentArticulation: patch.currentArticulation,
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a patch identity back out of a device-state chunk, or `null` when the chunk
 * holds none this build can use.
 *
 * Returning `null` rather than a repaired default is deliberate: the caller's own
 * default is the same one a device nobody has edited gets, and conflating the two
 * here would hide a version this reader cannot read behind a silent violin-1.
 *
 * The articulation is validated against the instrument's *own* articulation list
 * rather than against the full `ArticulationType` union — `pizzicato` is a real
 * articulation and a nonsense one to restore onto a trumpet, and the list is what
 * `setCurrentArticulation` resolves the display name from.
 */
export function fromLevainDeviceState(chunk: unknown): LevainPatchIdentity | null {
    if (!isRecord(chunk) || chunk.version !== LEVAIN_DEVICE_STATE_VERSION || !isRecord(chunk.data)) {
        return null;
    }

    const { instrumentId, currentArticulation } = chunk.data;
    if (!isInstrumentId(instrumentId)) {
        return null;
    }

    const defaultPatch = createDefaultPatch(instrumentId);
    const articulation = defaultPatch.articulations.find((entry) => entry.type === currentArticulation);

    return {
        instrumentId,
        currentArticulation: articulation?.type ?? defaultPatch.currentArticulation,
    };
}
