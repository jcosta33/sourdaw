import { runAllEffects } from '#/utils/runEffects';

import { modulationStore, modulationRuntimeStore } from '../../stores/modulationStore';

import { revertMappingsToBase } from './revertMappingsToBase';

type RemoveModulatorOptions = {
    deferRuntimeEffects?: boolean;
};

export function removeModulator(id: string, options: RemoveModulatorOptions = {}): (() => void) | null {
    const state = modulationStore.value;
    if (!state) {
        return null;
    }

    // The engine holds the modulator's last-written override on every param it
    // drove. Revert those params to their persisted base before deletion;
    // otherwise the param stays frozen at the last modulated value forever.
    const modulator = state.modulators.find((m) => m.id === id);
    const removedMappings = modulator?.mappings ?? [];

    modulationStore.set({
        modulators: state.modulators.filter((m) => m.id !== id),
    });

    let runtimeEffectsFinalized = false;
    function finalizeRuntimeEffects(): void {
        if (runtimeEffectsFinalized) {
            return;
        }
        runAllEffects([
            () => {
                if (removedMappings.length > 0) {
                    revertMappingsToBase(removedMappings);
                }
            },
            () => {
                const runtimeState = modulationRuntimeStore.value;
                if (runtimeState && id in runtimeState.runtimeValues) {
                    const runtimeValues = { ...runtimeState.runtimeValues };
                    delete runtimeValues[id];
                    modulationRuntimeStore.set({ runtimeValues });
                }
            },
        ]);
        runtimeEffectsFinalized = true;
    }
    if (!options.deferRuntimeEffects) {
        finalizeRuntimeEffects();
        return null;
    }
    return finalizeRuntimeEffects;
}
