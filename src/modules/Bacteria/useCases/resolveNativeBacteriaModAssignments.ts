import { type DeviceStateChunk } from '#/modules/Arrangement/stores';

import { fromBacteriaModAssignmentsState } from '../models/BacteriaModAssignmentsState';
import { resolveMappedBacteriaModAssignments } from '../models/BacteriaModulationIds';

/**
 * A Bacteria device's whole modulation-assignment table, mapped onto the
 * engine's own numeric grammar, or `null` when there is nothing safe to hand
 * a native body: `deviceState` is absent or unreadable, decodes to zero rows,
 * carries a row `resolveMappedBacteriaModAssignments` cannot map, or exceeds
 * the live node's own 64-row limit — the same refusals `prepareOfflineBacteria`
 * applies to the Web Audio offline export, from the one shared helper, so a
 * native build cannot apply a routing the corresponding live node itself
 * would have refused (#4685 slice 2).
 *
 * Registered as `src/app/nativeModAssignments.ts`'s `bacteria` entry, and
 * called from `projectDeviceForNativeBody` through the
 * `AudioDeviceRuntimeSink.nativeModAssignments` hook: `Device.deviceState`
 * never crosses the wire to the native engine
 * (`serializeAudioGraphCommand.ts` drops it), and only this module may decode
 * a bacteria device's chunk.
 */
export function resolveNativeBacteriaModAssignments(deviceState: DeviceStateChunk | undefined) {
    const assignments = fromBacteriaModAssignmentsState(deviceState);
    return resolveMappedBacteriaModAssignments(assignments);
}
