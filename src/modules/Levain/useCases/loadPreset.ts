/**
 * Preset loading use case — loads a patch into the store, forwards
 * all parameters to the audio engine, and triggers sample loading.
 */

import { type LevainPatch, createDefaultPatch, type InstrumentId } from '../models/LevainPatch';
import { levainStore } from '../stores/levainStore';
import { setLevainParamWithAudio, loadSamplesForInstrument } from './levainParamBridge';

/**
 * Load an instrument with default settings and trigger sample loading.
 */
export function loadInstrument(instrumentId: InstrumentId): void {
    const patch = createDefaultPatch(instrumentId);
    applyPatch(patch);
    // Trigger async sample load via the bridge (it holds the worklet port).
    loadSamplesForInstrument(instrumentId);
}

/**
 * Apply a complete patch to the store and forward all params to the engine.
 */
function applyPatch(patch: LevainPatch): void {
    const state = levainStore.value;
    if (!state) {
        return;
    }

    // Update the entire patch in the store.
    levainStore.set({
        ...state,
        patch,
        currentArticulationDisplay:
            patch.articulations.find((a) => a.type === patch.currentArticulation)?.name ??
            patch.currentArticulation,
    });

    // Forward all patch parameters to the audio engine.
    setLevainParamWithAudio('masterGain', patch.masterGain);
    setLevainParamWithAudio('legato', patch.legato);
    setLevainParamWithAudio('humanize', patch.humanize);
    setLevainParamWithAudio('expression', patch.expression);
}
