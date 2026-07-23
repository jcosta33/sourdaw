import { transformMidiGlobalTimeState } from '../../services/transformMidiGlobalTimeState';
import { midiStore } from '../../stores/midiStore';

export function removeMidiClipData(clipIds: readonly string[]): void {
    const state = midiStore.value;
    if (!state || clipIds.length === 0) {
        return;
    }

    const transformed = transformMidiGlobalTimeState({
        state,
        commands: [{ type: 'remove-clips', clipIds }],
        targetNoteIds: [],
    });
    if (transformed.status === 'rejected' || !transformed.hasChanges) {
        return;
    }

    midiStore.set(transformed.state);
}
