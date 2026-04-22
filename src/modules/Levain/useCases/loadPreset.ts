/**
 * Preset loading use case — loads a patch into the store, forwards
 * all parameters to the audio engine, and triggers sample loading.
 */

import { type LevainPatch, createDefaultPatch, type InstrumentId } from '../models/LevainPatch';
import { levainStore } from '../stores/levainStore';

import { loadSamplesForInstrument } from './levainParamBridge/loadSamplesForInstrument';
import { setLevainParamWithAudio } from './levainParamBridge/setLevainParamWithAudio';

/**
 * Load an instrument with default settings and trigger sample loading.
 */
export function loadInstrument(deviceId: string, instrumentId: InstrumentId): void {
    const patch = createDefaultPatch(instrumentId);
    applyPatch(deviceId, patch);
    // Trigger async sample load via the bridge (it holds the worklet port).
    loadSamplesForInstrument(deviceId, instrumentId);
}

/**
 * Apply a complete patch to the store and forward all params to the engine.
 */
function applyPatch(deviceId: string, patch: LevainPatch): void {
    const instances = levainStore.value;
    if (!instances) return;
    const state = instances[deviceId];
    if (!state) {
        return;
    }

    // Update the entire patch in the store.
    levainStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch,
            currentArticulationDisplay:
                patch.articulations.find((a) => a.type === patch.currentArticulation)?.name ?? patch.currentArticulation,
        },
    });

    // Forward all patch parameters to the audio engine.
    setLevainParamWithAudio(deviceId, 'masterGain', patch.masterGain);
    setLevainParamWithAudio(deviceId, 'legato', patch.legato);
    setLevainParamWithAudio(deviceId, 'humanize', patch.humanize);
    setLevainParamWithAudio(deviceId, 'expression', patch.expression);
}
