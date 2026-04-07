/**
 * Scoring tuner state store.
 * Keyed by deviceId to support multiple simultaneous instances.
 *
 * Write operations are exposed through useCases/:
 *   - setDisplayMode (user preference)
 *   - setA4Reference (user preference)
 *   - updateTunerTelemetry (audio engine telemetry push — also re-exported here for
 *     backward compat with AudioEngine/engine/wasmDeviceRegistry which imports from this path)
 */

import { createStore } from '#/infra/store/createStore';
import { type TunerState, DEFAULT_TUNER_STATE } from '../models/ScoringState';

type ScoringInstances = Record<string, TunerState>;

export const scoringStore = createStore<ScoringInstances>({ initialData: {} });

export function getScoringState(deviceId: string): TunerState {
    return scoringStore.value?.[deviceId] ?? { ...DEFAULT_TUNER_STATE };
}

/**
 * Push real-time tuner telemetry from the audio engine into the store.
 * Called by AudioEngine/engine/wasmDeviceRegistry on each audio callback.
 * High-frequency — does not go through an undo/redo boundary.
 */
export function updateTunerTelemetry(deviceId: string, data: Partial<TunerState>): void {
    const instances = scoringStore.value ?? {};
    const existing = instances[deviceId] ?? { ...DEFAULT_TUNER_STATE };
    scoringStore.set({ ...instances, [deviceId]: { ...existing, ...data } });
}
