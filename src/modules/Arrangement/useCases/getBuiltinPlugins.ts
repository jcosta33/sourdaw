import { BUILTIN_PLUGINS, type PluginDescriptor } from '../models/DeviceParameter';

export function getBuiltinPlugins(): readonly PluginDescriptor[] {
    return BUILTIN_PLUGINS;
}
