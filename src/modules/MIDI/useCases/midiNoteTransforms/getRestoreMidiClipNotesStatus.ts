import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

export type GetRestoreMidiClipNotesStatusInput = {
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
    noteTransformReplayGuard?: {
        trackId: string;
        expectedTrackFrozen: boolean;
        expectedClipLocked: boolean;
        expectedTempo?: number;
    };
};

export function getRestoreMidiClipNotesStatus({
    clipId,
    notes,
    expectedNotes,
    allowMissingExpectedEmpty = false,
    articulationReplayGuard,
    noteTransformReplayGuard,
}: GetRestoreMidiClipNotesStatusInput): 'written' | 'no-write' | 'conflict' {
    const state = midiStore.value;
    if (!state) {
        return 'conflict';
    }
    if (articulationReplayGuard) {
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === articulationReplayGuard.trackId);
        const sourceClip = track?.clips.find((clip) => clip.id === articulationReplayGuard.sourceClipId);
        const targetClip = track?.clips.find((clip) => clip.id === clipId);
        const sourceNotes = state.notesByClipId[articulationReplayGuard.sourceClipId];
        if (
            !track ||
            !sourceClip ||
            !targetClip ||
            sourceClip.type !== 'midi' ||
            targetClip.type !== 'midi' ||
            (track.frozen === true) !== articulationReplayGuard.expectedTrackFrozen ||
            (sourceClip.locked === true) !== articulationReplayGuard.expectedSourceClipLocked ||
            (targetClip.locked === true) !== articulationReplayGuard.expectedTargetClipLocked ||
            !sourceNotes ||
            !midiNotesEqual(sourceNotes, articulationReplayGuard.expectedSourceNotes)
        ) {
            return 'conflict';
        }
    }
    if (noteTransformReplayGuard) {
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === noteTransformReplayGuard.trackId);
        const clip = track?.clips.find((candidate) => candidate.id === clipId);
        if (
            !track ||
            !clip ||
            clip.type !== 'midi' ||
            (track.frozen === true) !== noteTransformReplayGuard.expectedTrackFrozen ||
            (clip.locked === true) !== noteTransformReplayGuard.expectedClipLocked ||
            (noteTransformReplayGuard.expectedTempo !== undefined &&
                transportStore.value?.tempo !== noteTransformReplayGuard.expectedTempo)
        ) {
            return 'conflict';
        }
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
    return midiNotesEqual(currentNotes, expectedNotes) ? 'written' : 'conflict';
}
