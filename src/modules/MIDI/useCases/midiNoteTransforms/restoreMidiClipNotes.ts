import { trackStore } from '#/modules/Arrangement/stores';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type RestoreMidiClipNotesInput = {
    clipId: string;
    notes: readonly MidiClipNoteSnapshot[];
    expectedNotes: readonly MidiClipNoteSnapshot[];
    allowMissingExpectedEmpty?: boolean;
    articulationReplayGuard?: {
        trackId: string;
        sourceClipId: string;
        expectedSourceNotes: readonly MidiClipNoteSnapshot[];
        expectedTrackFrozen: boolean;
        expectedSourceClipLocked: boolean;
        expectedTargetClipLocked: boolean;
    };
};

function isArticulationReplayGuardCurrent(
    clipId: string,
    guard: NonNullable<RestoreMidiClipNotesInput['articulationReplayGuard']>
): boolean {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === guard.trackId);
    const sourceClip = track?.clips.find((clip) => clip.id === guard.sourceClipId);
    const targetClip = track?.clips.find((clip) => clip.id === clipId);
    const sourceNotes = midiStore.value?.notesByClipId[guard.sourceClipId];
    return Boolean(
        track &&
        sourceClip &&
        targetClip &&
        sourceClip.type === 'midi' &&
        targetClip.type === 'midi' &&
        (track.frozen === true) === guard.expectedTrackFrozen &&
        (sourceClip.locked === true) === guard.expectedSourceClipLocked &&
        (targetClip.locked === true) === guard.expectedTargetClipLocked &&
        sourceNotes &&
        midiNotesEqual(sourceNotes, guard.expectedSourceNotes)
    );
}

export function restoreMidiClipNotes({
    clipId,
    notes,
    expectedNotes,
    allowMissingExpectedEmpty = false,
    articulationReplayGuard,
}: RestoreMidiClipNotesInput): 'written' | 'no-write' | 'conflict' {
    const state = midiStore.value;
    if (!state) {
        return 'conflict';
    }
    if (articulationReplayGuard && !isArticulationReplayGuardCurrent(clipId, articulationReplayGuard)) {
        return 'conflict';
    }
    const storedNotes = state.notesByClipId[clipId];
    const canTreatMissingAsEmpty = storedNotes === undefined && allowMissingExpectedEmpty && expectedNotes.length === 0;
    if (storedNotes === undefined && !canTreatMissingAsEmpty) {
        return 'conflict';
    }
    const currentNotes = storedNotes ?? [];
    if (midiNotesEqual(currentNotes, notes)) {
        return 'no-write';
    }
    if (!midiNotesEqual(currentNotes, expectedNotes)) {
        return 'conflict';
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: notes.map((note) => ({ ...note })),
        },
    });
    return 'written';
}
