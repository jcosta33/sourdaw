/**
 * Whether a device that kept its id and position would now build a different
 * native body, because the two states project a different `sampleBankKey`
 * (#4203).
 *
 * The bank-key law in one place: a musician picking another Levain instrument
 * neither inserts nor removes a device by id, so the ordinary chain diff sees
 * no change — but the engine's held instance was built from the bank its own
 * `insert-device` named, and holds no door to change which bank that is.
 * `mirrorDeviceChainDelta`'s `swappedDevices` and `handleSetDeviceState`'s
 * `projectedBankKeyChanged` both used to restate this comparison; centralized
 * here so the two callers cannot drift on what "the same instrument" means.
 */

import { type Device } from '#/modules/Arrangement/stores';

import { projectDeviceForNativeBody } from './projectDeviceForNativeBody';

export function projectsToDifferentNativeBank(before: Device, after: Device): boolean {
    return projectDeviceForNativeBody(before).sampleBankKey !== projectDeviceForNativeBody(after).sampleBankKey;
}
