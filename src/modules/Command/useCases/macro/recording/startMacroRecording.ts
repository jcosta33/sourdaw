import { macroStore } from '../../../stores/macroStore';

export function startMacroRecording(): void {
    const state = macroStore.value;
    if (!state || state.recording) {
        return;
    }
    macroStore.set({ ...state, recording: true, currentRecording: [] });
}