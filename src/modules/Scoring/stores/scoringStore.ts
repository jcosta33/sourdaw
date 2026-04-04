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

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type TunerState, DEFAULT_TUNER_STATE } from '../models/ScoringState';

const logger = Container.getInstance().get(Logger);

type ScoringInstances = Record<string, TunerState>;

export const scoringStore = new Store<ScoringInstances>(logger, { initialData: {} });

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
