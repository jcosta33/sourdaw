import { macroStore } from '../../../stores/macroStore';
import { type AppAction } from '../../commandQueries';

/** Actions that should NOT be recorded inside a macro (meta-actions). */
const EXCLUDED_ACTIONS = new Set(['startMacroRecording', 'stopMacroRecording', 'playMacro', 'deleteMacro']);

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