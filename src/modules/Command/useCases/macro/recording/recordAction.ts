import { type AppAction } from '#/utils/handlerContract';

import { macroRecordingExcludesActionType } from '../../../models/MacroRecordingExclusionPolicy';
import { macroStore } from '../../../stores/macroStore';

/**
 * Called from executeAppAction dispatch to capture actions during recording.
 * Filters out meta-actions (recording/playback commands).
 */
export function recordAction(action: AppAction): void {
    const state = macroStore.value;
    if (!state || !state.recording) {
        return;
    }
    if (macroRecordingExcludesActionType[action.type]) {
        return;
    }
    macroStore.set({
        ...state,
        currentRecording: [...state.currentRecording, action],
    });
}
