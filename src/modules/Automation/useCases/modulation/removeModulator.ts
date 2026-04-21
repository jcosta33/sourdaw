import { modulationStore, modulationRuntimeStore } from '../../stores/modulationStore';

export function removeModulator(id: string): void {
    const state = modulationStore.value;
    if (!state) {
        return;
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
