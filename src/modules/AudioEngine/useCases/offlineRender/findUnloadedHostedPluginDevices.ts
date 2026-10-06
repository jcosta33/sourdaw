import { type Device } from '#/modules/Arrangement/stores';

import { isDesktopExternalPluginRuntime } from '../../repositories/deviceStrategy/isDesktopExternalPluginRuntime';
import { isEngineHostedPluginDeviceType } from '../../repositories/deviceStrategy/isEngineHostedPluginDeviceType';
import { isHostedPluginInstanceLoaded } from '../../repositories/deviceStrategy/isHostedPluginInstanceLoaded';
import { readLoadedExternalInstanceIds } from '../livePlayback/readLoadedExternalInstanceIds';

/**
 * The hosted plugin devices an offline render would carry as a silent unity
 * pass-through, because no instance loaded on the desktop runtime backs them —
 * the devices `buildDeviceChain` leaves out of a render with only a warning.
 */
export function findUnloadedHostedPluginDevices<Candidate extends Pick<Device, 'type' | 'externalInstanceId'>>(
    devices: readonly Candidate[]
): Candidate[] {
    const runtime = {
        loadedInstanceIds: readLoadedExternalInstanceIds(),
        onDesktopRuntime: isDesktopExternalPluginRuntime(),
    };
    return devices.filter(
        (device) => isEngineHostedPluginDeviceType(device.type) && !isHostedPluginInstanceLoaded(device, runtime)
    );
}
