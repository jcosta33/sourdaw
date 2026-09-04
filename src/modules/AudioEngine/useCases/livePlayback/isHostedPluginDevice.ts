import { type AudioGraphDeviceChain } from '../../models/AudioGraphBackend';

/**
 * Whether this device is an externally hosted plugin, resolved to an engine
 * instance or not.
 *
 * Both halves matter, and for different readers: the carrier law asks so it can
 * name a plugin rather than a device type in the reason it hands back, and the
 * session asks so it can tell the musician about a plugin that is on the track
 * but will not be heard — including the one that never resolved to an instance,
 * which is exactly the case a check on `externalInstanceId` alone would miss.
 */
export function isHostedPluginDevice(device: AudioGraphDeviceChain[number]): boolean {
    return device.externalPluginId !== undefined || device.externalInstanceId !== undefined;
}
