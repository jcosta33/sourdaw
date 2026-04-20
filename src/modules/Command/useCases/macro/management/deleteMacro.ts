import { macroStore } from '../../../stores/macroStore';

export function deleteMacro(macroId: string): void {
    const state = macroStore.value;
    if (!state) {
        return;
    }
    macroStore.set({
        ...state,
        macros: state.macros.filter((m) => m.id !== macroId),
    });
}
