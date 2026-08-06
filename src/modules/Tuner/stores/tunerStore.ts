/**
 * Tuner state store.
 * Keyed by deviceId to support multiple simultaneous instances.
 *
 * Write operations are exposed through useCases/:
 *   - setDisplayMode (user preference)
 *   - updateTunerTelemetry (audio engine telemetry push — also re-exported here for
 *     backward compat with AudioEngine/engine/wasmDeviceRegistry which imports from this path)
 *
 * `setA4Reference` is deliberately not among them. The concert-A reference is a
 * DSP input, not panel state, so it goes to `Device.parameterValues` through
 * the device-parameter write doors; see `models/A4Reference.ts`.
 */

import { createStore } from '#/infra/store/createStore';

import { DEFAULT_TUNER_STATE, type DisplayMode, type TunerState } from '../models/TunerState';

// Re-exported here so existing importers of this store path keep resolving the
// canonical definitions from ../models/TunerState (no duplicate, no drift).
export { DEFAULT_TUNER_STATE };
export type { DisplayMode, TunerState };

type TunerInstances = Record<string, TunerState>;

export const tunerStore = createStore<TunerInstances>({ initialData: {} });

// Stable fallback for a device with no entry yet. `useStoreSelector` caches
// selections by `Object.is`; returning a fresh `{ ...DEFAULT_TUNER_STATE }` per
// call would make every selection a cache miss, re-rendering a mounted panel on
// every *other* device's telemetry tick. A single frozen reference keeps the
// fallback identity stable so the per-device subscription holds. Callers only
// ever spread this value ({ ...existing, ... }), never mutate it in place.
const FALLBACK_TUNER_STATE: TunerState = Object.freeze({ ...DEFAULT_TUNER_STATE });

export function getTunerState(deviceId: string): TunerState {
    return tunerStore.value?.[deviceId] ?? FALLBACK_TUNER_STATE;
}

/**
 * Merge a partial patch into one device's tuner state, preserving every field
 * not named in the patch. The single read-modify-write site for the store —
 * `updateTunerTelemetry` and the user-preference use cases all route through it,
 * so the `{ ...existing, ...patch }` preservation lives in exactly one place.
 */
export function mergeDeviceState(deviceId: string, patch: Partial<TunerState>): void {
    const instances = tunerStore.value ?? {};
    const existing = getTunerState(deviceId);
    tunerStore.set({ ...instances, [deviceId]: { ...existing, ...patch } });
}

/**
 * Push real-time tuner telemetry from the audio engine into the store.
 * Called by AudioEngine/engine/wasmDeviceRegistry on each audio callback.
 * High-frequency — does not go through an undo/redo boundary.
 */
export function updateTunerTelemetry(deviceId: string, data: Partial<TunerState>): void {
    mergeDeviceState(deviceId, data);
}
