import { createMidiNote } from '../../models/MidiNote';
import { transformMidiGlobalTimeState } from '../../services/transformMidiGlobalTimeState';
import { midiStore } from '../../stores/midiStore';

export type SplitMidiNotesAtBeatInput = {
    sourceClipId: string;
    newClipId: string;
    splitBeat: number;
    /**
     * Optional end bound for range deletion (deleteTimeRange): notes and
     * note parts in `[discardBeforeBeat, splitBeat)` are dropped instead of
     * kept on the source clip.
     */
    discardBeforeBeat?: number;
    targetNoteIds?: readonly string[];
};

export function splitMidiNotesAtBeat({
    sourceClipId,
    newClipId,
    splitBeat,
    discardBeforeBeat,
    targetNoteIds: suppliedTargetNoteIds,
}: SplitMidiNotesAtBeatInput): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const commands = [
        {
            type: 'split-notes' as const,
            sourceClipId,
            targetClipId: newClipId,
            splitBeat,
            ...(discardBeforeBeat === undefined ? {} : { discardBeforeBeat }),
        },
    ];
    const planned = transformMidiGlobalTimeState({ state, commands });
    if (planned.status === 'rejected' || !planned.hasChanges) {
        return;
    }

    const targetNoteIds = suppliedTargetNoteIds ?? planned.identityRequests.map(() => createMidiNote(0, 0, 0).id);
    const transformed = transformMidiGlobalTimeState({ state, commands, targetNoteIds });
    if (transformed.status === 'rejected' || !transformed.hasChanges) {
        return;
    }

    midiStore.set(transformed.state);
}
