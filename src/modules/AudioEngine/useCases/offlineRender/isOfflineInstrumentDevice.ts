import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';

import { resolveDeviceRoles } from '../../models/DeviceRolesByDeviceType';

/**
 * Whether a device type is a sound *source* in an offline render rather than a
 * pass-through insert.
 *
 * A bounce with `includeInserts: false` drops the track's effect chain, but it
 * must keep whatever actually makes the sound — otherwise bouncing a Fermenter
 * or Toaster track without inserts renders silence instead of a dry instrument
 * take (MD-4). The built-in answers live in the device-role table.
 */
export function isOfflineInstrumentDevice(deviceType: string): boolean {
    const roles = resolveDeviceRoles(deviceType);
    if (roles !== null) {
        return roles.offlineSource;
    }
    // A Faust device id is the module id, and `registerFaustDSP` records
    // whether that module is an instrument. Matching the `faust-` prefix would
    // keep every Faust *effect* too, so a dry bounce would come back wet.
    return isFaustInstrumentModule(deviceType);
}
