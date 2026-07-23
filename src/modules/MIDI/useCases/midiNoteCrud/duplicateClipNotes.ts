import { createMidiNote } from '../../models/MidiNote';
import { transformMidiGlobalTimeState } from '../../services/transformMidiGlobalTimeState';
import { midiStore } from '../../stores/midiStore';

export function duplicateClipNotes(sourceClipId: string, destClipId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const commands = [
        {
            type: 'copy-notes' as const,
            sourceClipId,
            targetClipId: destClipId,
        },
    ];
    const planned = transformMidiGlobalTimeState({ state, commands });
    if (planned.status === 'rejected' || !planned.hasChanges) {
        return;
    }

    const targetNoteIds = planned.identityRequests.map(() => createMidiNote(0, 0, 0).id);
    const transformed = transformMidiGlobalTimeState({ state, commands, targetNoteIds });
    if (transformed.status === 'rejected' || !transformed.hasChanges) {
        return;
    }

    midiStore.set(transformed.state);
}
