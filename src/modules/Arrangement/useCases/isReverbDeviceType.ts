import { getPluginById } from '../models/DeviceParameter';

/**
 * Stored types older projects carry for a reverb the catalogue no longer lists
 * under that id. No descriptor can declare them, so the owner names them here.
 */
const LEGACY_REVERB_DEVICE_TYPES: ReadonlySet<string> = new Set(['proof-chamber']);

/** Whether a stored device type is a reverb, by its descriptor's declared family. */
export function isReverbDeviceType(deviceType: string): boolean {
    return LEGACY_REVERB_DEVICE_TYPES.has(deviceType) || getPluginById(deviceType)?.effectFamily === 'reverb';
}
