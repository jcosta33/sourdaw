import { macroStore } from '../../stores/macroStore';
import { type Macro } from '../../models/Macro';

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

export function renameMacro(macroId: string, name: string): void {
    const state = macroStore.value;
    if (!state) {
        return;
    }
    macroStore.set({
        ...state,
        macros: state.macros.map((m) => (m.id === macroId ? { ...m, name } : m)),
    });
}

export function getMacros(): Macro[] {
    return macroStore.value?.macros ?? [];
}
