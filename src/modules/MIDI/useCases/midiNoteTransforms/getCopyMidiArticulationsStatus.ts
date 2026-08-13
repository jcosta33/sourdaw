import { trackStore } from '#/modules/Arrangement/stores';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { copyMidiArticulationsToNotes } from '../../transformers/copyMidiArticulationsToNotes';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type GetCopyMidiArticulationsStatusInput = {
    trackId: string;
    sourceClipId: string;
    targetClipId: string;
    notePairs: readonly { sourceNoteId: string; targetNoteId: string }[];
    expectedSourceNotes: readonly MidiClipNoteSnapshot[];
    expectedTargetNotes: readonly MidiClipNoteSnapshot[];
    expectedTrackFrozen: boolean;
    expectedSourceClipLocked: boolean;
    expectedTargetClipLocked: boolean;
};

export function getCopyMidiArticulationsStatus(
    input: GetCopyMidiArticulationsStatusInput
): 'written' | 'no-write' | 'conflict' {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === input.trackId);
    const sourceClip = track?.clips.find((clip) => clip.id === input.sourceClipId);
    const targetClip = track?.clips.find((clip) => clip.id === input.targetClipId);
    const state = midiStore.value;
    const sourceNotes = state?.notesByClipId[input.sourceClipId];
    const targetNotes = state?.notesByClipId[input.targetClipId];
    if (
        !track ||
        !sourceClip ||
        !targetClip ||
        sourceClip.type !== 'midi' ||
        targetClip.type !== 'midi' ||
        (track.frozen === true) !== input.expectedTrackFrozen ||
        (sourceClip.locked === true) !== input.expectedSourceClipLocked ||
        (targetClip.locked === true) !== input.expectedTargetClipLocked ||
        !state ||
        !sourceNotes ||
        !targetNotes ||
        !midiNotesEqual(sourceNotes, input.expectedSourceNotes) ||
        !midiNotesEqual(targetNotes, input.expectedTargetNotes)
    ) {
        return 'conflict';
    }
    const nextTargetNotes = copyMidiArticulationsToNotes({
        sourceNotes,
        targetNotes,
        notePairs: input.notePairs,
    });
    if (!nextTargetNotes) {
        return 'conflict';
    }
    return midiNotesEqual(targetNotes, nextTargetNotes) ? 'no-write' : 'written';
}
