import { type DeviceStateChunk } from '#/modules/Arrangement/stores';
import { resolveNativeBacteriaModAssignments } from '#/modules/Bacteria/useCases';
import { type NativeDspDeviceType, resolveNativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

/** One modulation-assignment row, spelled the way the native wire takes it. */
export type NativeModAssignmentRow = Readonly<{ sourceId: number; targetParam: number; amount: number }>;

export type NativeModAssignmentsInput = {
    /** Device type, as `projectDeviceForNativeBody` read it off the project. */
    deviceType: string;
    /** Project state that carries the device's modulation-routing table, if any. */
    deviceState: DeviceStateChunk | undefined;
};

/**
 * A device's whole modulation-assignment table, mapped onto the engine's own
 * numeric grammar, or `null` for a type with no such table or a chunk this
 * cannot read.
 */
type NativeModAssignmentsForDeviceState = (
    deviceState: DeviceStateChunk | undefined
) => readonly NativeModAssignmentRow[] | null;

/**
 * Every native-DSP device, and the modulation-assignment table its
 * `deviceState` names.
 *
 * Mirrors `NATIVE_SAMPLE_BANK_KEYS` in `nativeSampleBanks.ts` and
 * `NATIVE_DEVICE_STATE_PROJECTIONS` in `projectNativeDeviceState.ts`: `null` is
 * a decision, not a gap — only Bacteria carries a routing table at all, so
 * every other type has nothing to project. The table stays exhaustive over
 * `NativeDspDeviceType` so a new native device fails to compile here until
 * someone decides whether it needs a modulation-assignment door too.
 *
 * Ordered to match `NATIVE_DSP_DEVICE_TYPES` so the tables read as one list.
 */
const NATIVE_MOD_ASSIGNMENTS: Record<NativeDspDeviceType, NativeModAssignmentsForDeviceState | null> = {
    fermenter: null,
    toaster: null,
    levain: null,
    'builtin-crumbs': null,
    'grand-boule': null,
    gluten: null,
    crust: null,
    // The one native body with a variable-length modulation-routing table
    // rather than a fixed `parameterValues` vocabulary (#4685 slice 2).
    bacteria: resolveNativeBacteriaModAssignments,
    grinder: null,
    proof: null,
    'dutch-oven': null,
    'native-scoring': null,
    knead: null,
};

/**
 * A device's modulation-assignment table as a native body needs it, or `null`
 * for a type that carries none (#4685 slice 2).
 *
 * Registered as `AudioDeviceRuntimeSink.nativeModAssignments`, the
 * live/offline-via-native mirror of `prepareOfflineBacteria` for the Web
 * Audio offline worklet path: both exist because `Device.deviceState` is
 * opaque and only the owning module may decode it, and both dispatch from the
 * composition root because `projectDeviceForNativeBody` may not import a
 * device module's use cases directly.
 */
export function nativeModAssignments(input: NativeModAssignmentsInput): readonly NativeModAssignmentRow[] | null {
    const deviceType = resolveNativeDspDeviceType(input.deviceType);
    if (!deviceType) {
        return null;
    }

    const resolve = NATIVE_MOD_ASSIGNMENTS[deviceType];
    return resolve ? resolve(input.deviceState) : null;
}
