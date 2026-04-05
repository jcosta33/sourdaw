import { getPlatformPlugins as repoGetPlatformPlugins } from '../repositories/getPlatformPlugins';
import { type PluginDescriptor } from '../models/DeviceParameter';

export function getPlatformPlugins(): readonly PluginDescriptor[] {
    return repoGetPlatformPlugins();
}
