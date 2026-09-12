import { type DeviceStateChunk } from '#/modules/Arrangement/stores';
import { acquireLevainNativeBank, nativeBankKeyForLevainDeviceState } from '#/modules/Levain/useCases';
import { type NativeDspDeviceType, resolveNativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

export type NativeSampleBankKeyInput = {
    /** Device type, as `projectDeviceForNativeBody` read it off the project. */
    deviceType: string;
    /** Project state that says which material the device sounds. */
    deviceState: DeviceStateChunk | undefined;
};

/**
 * What one native device's `deviceState` names as its bank.
 *
 * `undefined` is passed through rather than shortcut here: a device that has
 * committed no chunk still sounds *something* on the Web Audio carrier, and
 * only the owning module knows what — so the owner decides whether a chunkless
 * device names a bank.
 */
type NativeSampleBankKeyForDeviceState = (deviceState: DeviceStateChunk | undefined) => string | null;

/**
 * Every native-DSP device, and the bank key its `deviceState` names.
 *
 * `null` is a decision, not a gap: a native body built entirely from its
 * `parameterValues` record needs no material staged ahead of it, so there is no
 * key to name. The table stays exhaustive over `NativeDspDeviceType` so a new
 * native device fails to compile here until someone decides whether its body is
 * built from staged material — the same reason that table exists.
 *
 * Ordered to match `NATIVE_DSP_DEVICE_TYPES` so the two tables read as one list.
 */
const NATIVE_SAMPLE_BANK_KEYS: Record<NativeDspDeviceType, NativeSampleBankKeyForDeviceState | null> = {
    fermenter: null,
    // Its kit is projected into the record, not staged as material.
    toaster: null,
    // The one body the engine builds from a bank rather than from a record:
    // `map_device` answers `Err` for a Levain device whose key holds no
    // committed bank, and on an audible strip that refuses the batch whole.
    levain: (deviceState) => nativeBankKeyForLevainDeviceState({ deviceState }),
    // Also sample-backed, but streamed from disk by the engine itself rather
    // than staged by the renderer: Crumbs has no native built-in body here.
    'builtin-crumbs': null,
    // Sampled, yet its material is compiled into the engine's own model rather
    // than staged per project.
    'grand-boule': null,
    gluten: null,
    crust: null,
    bacteria: null,
    grinder: null,
    proof: null,
    'dutch-oven': null,
    'native-scoring': null,
    knead: null,
};

/**
 * The bank key one device sounds, or `null` for a body built from its record
 * (#3124).
 *
 * Registered as `AudioDeviceRuntimeSink.nativeSampleBankKey`, and dispatched
 * from the composition root for the same reason `projectNativeDeviceState` is:
 * `Device.deviceState` is opaque and only the owning module may decode it,
 * while the mapper that puts the device on the wire may not import that
 * module's use cases.
 */
export function nativeSampleBankKey(input: NativeSampleBankKeyInput): string | null {
    const deviceType = resolveNativeDspDeviceType(input.deviceType);
    if (!deviceType) {
        return null;
    }

    const readKey = NATIVE_SAMPLE_BANK_KEYS[deviceType];
    return readKey ? readKey(input.deviceState) : null;
}

/**
 * Lease the decoded bank a key names, or `null` when no module owns the key.
 *
 * Each owner answers `null` for a key it did not mint, so the key's own prefix
 * does the routing — without a second table of who owns what, and without a
 * copy here of a prefix the owning module defines. A decode that *fails* throws
 * instead; `registerNativeSampleBanks` leaves the key unregistered either way,
 * and `map_device` then answers `Err` for the device by name. On an audible
 * strip that `Err` refuses the batch whole, so the play gesture declines native
 * carriage with the bank in its reason and the project plays on the Web Audio
 * carrier (`startNativeLiveGraphSession`); only a device on a strip that
 * contributes no audio is dropped on its own.
 */
export async function acquireNativeSampleBank(bankKey: string) {
    return acquireLevainNativeBank(bankKey);
}
