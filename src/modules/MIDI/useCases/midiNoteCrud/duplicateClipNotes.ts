import { createMidiNote } from '../../models/MidiNote';
import { transformMidiGlobalTimeState } from '../../services/transformMidiGlobalTimeState';
import { midiStore } from '../../stores/midiStore';
import { snapshotMidiClipData } from '../midiClipData/snapshotMidiClipData';

export function duplicateClipNotes(
    sourceClipId: string,
    destClipId: string
):
    | {
          readonly source: ReturnType<typeof snapshotMidiClipData>;
          readonly target: ReturnType<typeof snapshotMidiClipData>;
      }
    | undefined {
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
    if (planned.status === 'rejected') {
        return;
    }
    if (!planned.hasChanges) {
        return {
            source: snapshotMidiClipData(state, sourceClipId),
            target: snapshotMidiClipData(state, destClipId),
        };
    }

    const targetNoteIds = planned.identityRequests.map(() => createMidiNote(0, 0, 0).id);
    const transformed = transformMidiGlobalTimeState({ state, commands, targetNoteIds });
    if (transformed.status === 'rejected' || !transformed.hasChanges) {
        return;
    }

    // These are the producer's constructed values, isolated before a synchronous
    // publication observer can replace or mutate the live target.
    const capture = {
        source: snapshotMidiClipData(state, sourceClipId),
        target: snapshotMidiClipData(transformed.state, destClipId),
    };
    midiStore.set(transformed.state);
    return capture;
}
