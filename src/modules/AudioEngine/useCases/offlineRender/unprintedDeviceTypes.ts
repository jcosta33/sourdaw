import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';
import { type Track } from '#/modules/Arrangement/stores';

import { isOfflineInstrumentDevice } from './isOfflineInstrumentDevice';

/**
 * The device types on a render's target whose latency its print does not carry,
 * so the head it crops leaves them out.
 *
 * A bounce without inserts keeps only the instruments (`projectStripTrack`), and
 * the offline chain stands a silent pass-through in for a type this build
 * withholds (`buildDeviceChain`). Neither delays a printed sample. Both rules
 * read the type alone, so the omission is by type.
 */
export function unprintedDeviceTypes(devices: Track['devices'], includeInserts: boolean): string[] {
    const omitted = new Set<string>();
    for (const device of devices) {
        const withheldInsert = !includeInserts && !isOfflineInstrumentDevice(device.type);
        if (withheldInsert || !isDeviceReleaseAdmitted(device.type)) {
            omitted.add(device.type);
        }
    }
    return [...omitted];
}
