import { clearReportedLatency } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';

import { getTrackStoreState } from '../getTrackStoreState';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

import { EXTERNAL_PLUGIN_DEVICE_TYPE } from './externalPluginDeviceType';

import type { Device } from '../../stores/trackStore';

export type HostedPluginInstance = { deviceId: string; instanceId: string };

type DeviceHolder = { devices: readonly Pick<Device, 'id' | 'type' | 'externalInstanceId'>[] };

/** The hosted plugin instances a track's devices own, in device order. */
export function collectHostedPluginInstances(track: DeviceHolder): HostedPluginInstance[] {
    const instances: HostedPluginInstance[] = [];
    for (const device of track.devices) {
        if (device.type === EXTERNAL_PLUGIN_DEVICE_TYPE && device.externalInstanceId) {
            instances.push({ deviceId: device.id, instanceId: device.externalInstanceId });
        }
    }
    return instances;
}

/**
 * Requests native instances for the hosted plugins of a track an action just created. The track
 * is re-read from the committed store, so a track the commit did not keep activates nothing.
 * Activation failures are reported by the plugin host's activation state, not thrown here.
 */
export function activateCreatedTrackHostedPlugins(trackId: string): void {
    const committed = getTrackStoreState()?.tracks.find((track) => track.id === trackId);
    if (!committed || collectHostedPluginInstances(committed).length === 0) {
        return;
    }
    projectTrackToLiveStrip({ trackId, activateDormantExternalPlugins: true });
}

/**
 * Releases the hosted plugin instances of a discarded track, once the document write has
 * committed, except any instance a surviving track still holds.
 */
export async function unloadDiscardedHostedPlugins(instances: readonly HostedPluginInstance[]): Promise<void> {
    const survivingInstanceIds = new Set(
        (getTrackStoreState()?.tracks ?? []).flatMap((track) =>
            collectHostedPluginInstances(track).map((instance) => instance.instanceId)
        )
    );
    for (const { deviceId, instanceId } of instances) {
        if (survivingInstanceIds.has(instanceId)) {
            continue;
        }
        await unloadPlugin(instanceId);
        clearReportedLatency(deviceId);
    }
}
