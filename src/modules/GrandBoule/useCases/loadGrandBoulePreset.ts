/**
 * Apply a built-in Grand Boule preset to the current instance.
 *
 * Pulls the preset parameters into the store. Returns `true` on success,
 * `false` if the preset id is unknown.
 */

import { findBuiltinGrandBoulePreset } from '../repositories/findBuiltinGrandBoulePreset';
import { grandBouleStore } from '../stores/grandBouleStore';

type LoadGrandBoulePresetInput = { presetId: string };

export const loadGrandBoulePreset = (input: LoadGrandBoulePresetInput): boolean => {
    const preset = findBuiltinGrandBoulePreset(input.presetId);
    if (preset === null) {
        return false;
    }
    const state = grandBouleStore.value;
    if (state === null) {
        return false;
    }
    grandBouleStore.set({
        ...state,
        parameters: { ...preset.parameters },
        config: { ...state.config, activePresetId: preset.id },
    });
    return true;
};
