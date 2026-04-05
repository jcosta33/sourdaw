import { macroStore } from '../../stores/macroStore';
import { type AppAction } from '../../models/AppAction';
import { type Macro } from '../../models/Macro';

// Re-export for cross-module use
export type { Macro } from '../../models/Macro';

/** Actions that should NOT be recorded inside a macro (meta-actions). */
const EXCLUDED_ACTIONS = new Set(['startMacroRecording', 'stopMacroRecording', 'playMacro', 'deleteMacro']);

export function startMacroRecording(): void {
    const state = macroStore.value;
    if (!state || state.recording) {
        return;
    }
    macroStore.set({ ...state, recording: true, currentRecording: [] });
}

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

/**
 * Called from executeAppAction dispatch to capture actions during recording.
 * Filters out meta-actions (recording/playback commands).
 */
export function recordAction(action: AppAction): void {
    const state = macroStore.value;
    if (!state || !state.recording) {
        return;
    }
    if (EXCLUDED_ACTIONS.has(action.type)) {
        return;
    }
    macroStore.set({
        ...state,
        currentRecording: [...state.currentRecording, action],
    });
}
