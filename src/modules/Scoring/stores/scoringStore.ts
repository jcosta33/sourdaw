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

export type DisplayMode = 'needle' | 'strobe' | 'poly';

export type TunerState = {
    frequency: number;
    cents: number;
    confidence: number;
    noteIndex: number;
    octave: number;
    midiNote: number;
    noteName: string;
    active: boolean;
    mode: DisplayMode;
    a4Reference: number;
};

export const DEFAULT_TUNER_STATE: TunerState = {
    frequency: 0,
    cents: 0,
    confidence: 0,
    noteIndex: 9,
    octave: 4,
    midiNote: 69,
    noteName: 'A',
    active: false,
    mode: 'needle',
    a4Reference: 440,
};

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
