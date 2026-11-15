import { type Track } from '../../stores/trackStore';

import { EXTERNAL_PLUGIN_DEVICE_TYPE } from './externalPluginDeviceType';

export type HostedPluginInstance = { deviceId: string; instanceId: string };

/** The hosted plugin instances a track's devices own, in device order. */
export function collectHostedPluginInstances(track: Pick<Track, 'devices'>): HostedPluginInstance[] {
    const instances: HostedPluginInstance[] = [];
    for (const device of track.devices) {
        if (device.type === EXTERNAL_PLUGIN_DEVICE_TYPE && device.externalInstanceId) {
            instances.push({ deviceId: device.id, instanceId: device.externalInstanceId });
        }
    }
    return instances;
}
