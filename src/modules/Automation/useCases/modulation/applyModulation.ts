import { modulationStore, modulationRuntimeStore } from '../../stores/modulationStore';

import { computeModulatorValue } from './computeModulatorValue';

/**
 * Apply procedural modulation for the current playhead position.
 * Computes runtime values for all active modulators (LFO, Env, Step).
 * R-F2: Output feeds into modulation halos.
 */
export function applyModulation(playheadBeat: number): void {
    const state = modulationStore.value;
    if (!state || state.modulators.length === 0) {
        return;
    }

    const rtState = modulationRuntimeStore.value;
    const runtimeValues: Record<string, number> = { ...(rtState?.runtimeValues ?? {}) };
    let changed = false;

    for (const mod of state.modulators) {
        if (!mod.enabled) {
            // A disabled modulator contributes no modulation, so its runtime
            // entry must be cleared the same way `removeModulator` clears one —
            // otherwise the inspector halo keeps showing the last computed
            // value as if it were live. Cleared here rather than in the enable
            // toggle so every path that disables (local toggle, a peer's CRDT
            // update, a hydrated project) is covered.
            if (mod.id in runtimeValues) {
                delete runtimeValues[mod.id];
                changed = true;
            }
            continue;
        }

        const value = computeModulatorValue(mod, playheadBeat);
        if (runtimeValues[mod.id] !== value) {
            runtimeValues[mod.id] = value;
            changed = true;
        }
    }

    if (changed) {
        modulationRuntimeStore.set({ runtimeValues });
    }
}
