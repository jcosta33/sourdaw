import { EXTERNAL_PLUGIN_DEVICE_TYPE } from './externalPluginDeviceType';

/** Whether a device is a hosted plugin, the only kind that owns a live host instance to copy. */
export function isHostedPluginDevice(source: { type: string; externalPluginId?: string }): boolean {
    return source.type === EXTERNAL_PLUGIN_DEVICE_TYPE && Boolean(source.externalPluginId);
}
