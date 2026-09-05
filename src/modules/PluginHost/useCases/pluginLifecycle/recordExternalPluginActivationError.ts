import { setActivationStatus } from './activationStatus';

/**
 * Called by a projection that could not activate a hosted plugin because the
 * live engine renders no audio (no sample rate to activate at) — records the
 * refusal on the instance's activation entry, so the device rack shows
 * Unavailable + Retry instead of a healthy-looking device whose editor can
 * only fail.
 */
export function recordExternalPluginActivationError(instanceId: string, message: string): void {
    setActivationStatus(instanceId, 'error', message);
}
