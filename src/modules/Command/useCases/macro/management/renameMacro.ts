import { macroStore } from '../../../stores/macroStore';

export function renameMacro(macroId: string, name: string): void {
    const state = macroStore.value;
    if (!state) {
        return;
    }
    macroStore.set({
        ...state,
        macros: state.macros.map((message) => (message.id === macroId ? { ...message, name } : message)),
    });
}
