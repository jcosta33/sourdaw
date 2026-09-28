import { type Store } from '#/infra/store/types';

import { findBuiltinGrandBoulePreset } from '../repositories/findBuiltinGrandBoulePreset';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { commitGrandBouleDeviceState } from './commitGrandBouleDeviceState';

type LoadGrandBoulePresetInput = {
    engine: GrandBouleEngineHandle;
    presetId: string;
    store: Store<GrandBouleState>;
    /**
     * The owning device's id. A preset pick only reaches project truth — and
     * so a reload or an offline render (#4727) — when the caller names the
     * device, the same way a morph edit does; the engine and store updates
     * happen either way.
     */
    deviceId?: string;
};

export function loadGrandBoulePreset(input: LoadGrandBoulePresetInput): boolean {
    const preset = findBuiltinGrandBoulePreset(input.presetId);
    if (preset === null) {
        return false;
    }
    const state = input.store.value;
    if (state === null) {
        return false;
    }

    // Update the store.
    input.store.set({
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

    if (input.deviceId !== undefined) {
        commitGrandBouleDeviceState(input.deviceId, {
            morph: state.morph,
            temperament: state.temperament,
            parameters: { ...preset.parameters },
        });
    }

    return true;
}
