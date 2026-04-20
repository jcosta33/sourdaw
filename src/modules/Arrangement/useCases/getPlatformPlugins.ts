import { type PluginDescriptor } from '../models/DeviceParameter';
import { getPlatformPlugins as repoGetPlatformPlugins } from '../repositories/getPlatformPlugins';

export function getPlatformPlugins(): readonly PluginDescriptor[] {
    return repoGetPlatformPlugins();
}
