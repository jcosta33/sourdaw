import { modulationStore } from '../../stores/modulationStore';

export function removeMapping(modulatorId: string, targetParamId: string): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }
    modulationStore.set({
        modulators: state.modulators.map((m) =>
            m.id === modulatorId
                ? { ...m, mappings: m.mappings.filter((x) => x.targetParamId !== targetParamId) }
                : m
        ),
    });
}
