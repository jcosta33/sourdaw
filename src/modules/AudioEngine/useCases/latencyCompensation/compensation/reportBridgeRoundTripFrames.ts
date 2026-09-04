import { externalBridgeRoundTripFrames } from './externalLatencyRegistry';

/**
 * Record what the native host measured its own plugin round trip to cost for one
 * external-plugin device, in frames of the engine rate the plugin was activated
 * with.
 *
 * Reported rather than derived: the depth it settles at is decided by the device
 * period the native audio callback runs on, which this process never sees.
 *
 * Web Audio's plugin-delay compensation no longer reads it (#3564) — the native
 * engine sounds the plugin, and the device left in the Web Audio chain is a
 * pass-through. Called once per instance, at activation, and never again.
 */
export function reportBridgeRoundTripFrames(deviceId: string, frames: number): void {
    externalBridgeRoundTripFrames.set(deviceId, frames);
}
