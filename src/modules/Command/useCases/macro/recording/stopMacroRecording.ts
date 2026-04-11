import { macroStore } from '../../../stores/macroStore';
import { type Macro } from '../../../models/Macro';

export type { Macro };

export function stopMacroRecording(name: string): void {
    const state = macroStore.value;
    if (!state || !state.recording) {
        return;
    }

    const macro: Macro = {
        id: `macro-${crypto.randomUUID().slice(0, 8)}`,
        name: name.trim() || `Macro ${state.macros.length + 1}`,
        actions: [...state.currentRecording],
        createdAt: Date.now(),
    };

    macroStore.set({
        macros: [...state.macros, macro],
        recording: false,
        currentRecording: [],
    });
}