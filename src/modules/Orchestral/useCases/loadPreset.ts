/**
 * Preset loading use case — loads a patch into the store and forwards
 * all parameters to the audio engine via the param bridge.
 */

import { type OrchestraPatch, createDefaultPatch, type InstrumentId } from '../models/OrchestraPatch';
import { orchestralStore } from '../stores/orchestralStore';
import { loadPreset as loadPresetFromRepo } from '../repositories/orchestralPresets';
import { setOrchestraParamWithAudio } from './orchestralParamBridge';

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
function applyPatch(patch: OrchestraPatch): void {
    const state = orchestralStore.value;
    if (!state) {
        return;
    }

    // Update the entire patch in the store.
    orchestralStore.set({
        ...state,
        patch,
        currentArticulationDisplay:
            patch.articulations.find((a) => a.type === patch.currentArticulation)?.name ??
            patch.currentArticulation,
    });

    // Forward key numeric parameters to the audio engine via the param bridge.
    setOrchestraParamWithAudio('masterGain', patch.masterGain);
}
