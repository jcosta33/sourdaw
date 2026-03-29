/**
 * Preset loading use case — loads a patch into the store and forwards
 * all parameters to the audio engine via the param bridge.
 */

import { type LevainPatch, createDefaultPatch, type InstrumentId } from '../models/LevainPatch';
import { levainStore } from '../stores/levainStore';
import { loadPreset as loadPresetFromRepo } from '../repositories/levainPresets';
import { setLevainParamWithAudio } from './levainParamBridge';

/**
 * Load a factory preset by ID.
 */
export function loadFactoryPreset(presetId: string): void {
    const patch = loadPresetFromRepo(presetId);
    if (!patch) {
        return;
    }
    applyPatch(patch);
}

/**
 * Load an instrument with default settings.
 */
export function loadInstrument(instrumentId: InstrumentId): void {
    const patch = createDefaultPatch(instrumentId);
    applyPatch(patch);
}

/**
 * Apply a complete patch to the store and forward key params to the engine.
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

    // Forward key numeric parameters to the audio engine via the param bridge.
    setLevainParamWithAudio('masterGain', patch.masterGain);
}
