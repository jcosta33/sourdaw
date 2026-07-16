import { type ToasterDeviceControls } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Resolve the live Toaster control surface for a loaded device, or `undefined`
 * if no loaded toaster device matches. Encapsulates the strip / device-node
 * traversal inside AudioEngine so foreign modules (Toaster) never touch strip
 * internals to hydrate a device.
 */
export function getToasterDeviceControls(deviceId: string): ToasterDeviceControls | undefined {
    return audioEngine.findToasterControls(deviceId);
}
