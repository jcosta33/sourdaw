import { type PluginDescriptor } from '../../models/DeviceParameter';
import { getPlatformPlugins } from '../getPlatformPlugins';

/** The platform plugin `addDevice` places for a device type, named by its id or its display name. */
export function findAddedDevicePlugin(deviceType: string): PluginDescriptor | undefined {
    return getPlatformPlugins().find(
        (candidate) => candidate.name.toLowerCase() === deviceType.toLowerCase() || candidate.id === deviceType
    );
}
