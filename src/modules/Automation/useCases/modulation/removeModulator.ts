import { modulationStore, modulationRuntimeStore } from '../../stores/modulationStore';

import { revertMappingsToBase } from './applyModulationToEngine';

export function removeModulator(id: string): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }

    // The engine holds the modulator's last-written override on every param it
    // drove. Revert those params to their persisted base before deletion;
    // otherwise the param stays frozen at the last modulated value forever.
    const modulator = state.modulators.find((m) => m.id === id);
    if (modulator && modulator.mappings.length > 0) {
        revertMappingsToBase(modulator.mappings);
    }

    modulationStore.set({
        modulators: state.modulators.filter((m) => m.id !== id),
    });

    const rt = modulationRuntimeStore.value;
    if (rt && id in rt.runtimeValues) {
        const runtimeValues = { ...rt.runtimeValues };
        delete runtimeValues[id];
        modulationRuntimeStore.set({ runtimeValues });
    }
}
