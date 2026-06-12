import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

export function updateMapping(modulatorId: string, targetParamId: string, patch: Partial<ModulatorMapping>): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }
    modulationStore.set({
        modulators: state.modulators.map((m) =>
            m.id === modulatorId
                ? {
                      ...m,
                      mappings: m.mappings.map((x) =>
                          x.targetParamId === targetParamId ? { ...x, ...patch, targetParamId: x.targetParamId } : x
                      ),
                  }
                : m
        ),
    });
}
