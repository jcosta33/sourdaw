import { externalBridgeRoundTripFrames } from './externalLatencyRegistry';

/**
 * Record what the native host measured its audio bridge to cost for one
 * external-plugin device, in frames of the engine rate the plugin was activated
 * with. `getDeviceLatencyMs` adds it to the latency the plugin reports for
 * itself.
 *
 * Reported rather than derived: the depth the bridge settles at is decided by
 * the device period the native audio callback runs on, which this process never
 * sees.
 *
 * Temporary, with the bridge: jcosta33/sourdaw#2230 replaces the worklet relay
 * with the native graph, and this goes with it.
 */
export function reportBridgeRoundTripFrames(deviceId: string, frames: number): void {
    externalBridgeRoundTripFrames.set(deviceId, frames);
}
