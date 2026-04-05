import { getPluginById as modelGetPluginById, type PluginDescriptor } from '../models/DeviceParameter';

export function getPluginById(pluginId: string): PluginDescriptor | undefined {
    return modelGetPluginById(pluginId);
}
