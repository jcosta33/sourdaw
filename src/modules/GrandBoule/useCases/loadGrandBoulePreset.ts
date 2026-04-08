/**
 * Apply a built-in Grand Boule preset to the current instance.
 *
 * Pushes preset parameters into the store AND dispatches them to the
 * WASM engine so the sound actually changes. Returns `true` on success,
 * `false` if the preset id is unknown.
 */

import { inject } from '#/infra/di/inject';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { findBuiltinGrandBoulePreset } from '../repositories/findBuiltinGrandBoulePreset';
import { grandBouleStore } from '../stores/grandBouleStore';

type LoadGrandBoulePresetInput = {
    engine: GrandBouleEngineHandle;
    presetId: string;
};

export const loadGrandBoulePreset = inject({ findBuiltinGrandBoulePreset })(
    ({ findBuiltinGrandBoulePreset }) =>
        function loadGrandBoulePreset(input: LoadGrandBoulePresetInput): boolean {
            const preset = findBuiltinGrandBoulePreset(input.presetId);
            if (preset === null) {
                return false;
            }
            const state = grandBouleStore.value;
            if (state === null) {
                return false;
            }

            // Update the store.
            grandBouleStore.set({
                ...state,
                parameters: { ...preset.parameters },
                config: { ...state.config, activePresetId: preset.id },
            });

            // Dispatch every preset parameter to the WASM engine.
            const { engine } = input;
            const p = preset.parameters;
            engine.setParam({ name: 'hammer_hardness', value: p.hammerHardness });
            engine.setParam({ name: 'tone_tilt', value: p.toneTilt });
            engine.setParam({ name: 'stereo_width', value: p.stereoWidth });
            engine.setParam({ name: 'velocity_curve', value: p.velocityCurve });

            return true;
        }
);
