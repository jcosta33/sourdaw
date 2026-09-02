import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { isRestoreMidiClipNotesReplayArguments } from '../../transformers/isRestoreMidiClipNotesReplayArguments';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

export type GetRestoreMidiClipNotesStatusInput = {
    clipId: string;
    notes: readonly MidiClipNoteSnapshot[];
    expectedNotes: readonly MidiClipNoteSnapshot[];
    notesBucketPresent?: boolean;
    expectedNotesBucketPresent?: boolean;
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
    projectedNotes?: readonly MidiClipNoteSnapshot[];
    projectedNotesBucketPresent?: boolean;
    projectedNoteTransformReplayTarget?: {
        trackId: string;
        trackFrozen: boolean;
        clipLocked: boolean;
    };
};

type NoteTransformReplayTarget = NonNullable<GetRestoreMidiClipNotesStatusInput['projectedNoteTransformReplayTarget']>;

function readLiveNoteTransformReplayTarget(trackId: string, clipId: string): NoteTransformReplayTarget | undefined {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    if (!track || !clip || clip.type !== 'midi') {
        return undefined;
    }
    return { trackId: track.id, trackFrozen: track.frozen === true, clipLocked: clip.locked === true };
}

export function getRestoreMidiClipNotesStatus({
    clipId,
    notes,
    expectedNotes,
    notesBucketPresent,
    expectedNotesBucketPresent,
    allowMissingExpectedEmpty = false,
    articulationReplayGuard,
    noteTransformReplayGuard,
    projectedNotes,
    projectedNotesBucketPresent,
    projectedNoteTransformReplayTarget,
}: GetRestoreMidiClipNotesStatusInput): 'written' | 'no-write' | 'conflict' {
    if (
        !isRestoreMidiClipNotesReplayArguments({
            notes,
            expectedNotes,
            notesBucketPresent,
            expectedNotesBucketPresent,
        })
    ) {
        return 'conflict';
    }
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
        const replayTarget =
            projectedNoteTransformReplayTarget ??
            readLiveNoteTransformReplayTarget(noteTransformReplayGuard.trackId, clipId);
        if (!replayTarget) {
            return 'conflict';
        }
        if (
            replayTarget.trackId !== noteTransformReplayGuard.trackId ||
            replayTarget.trackFrozen !== noteTransformReplayGuard.expectedTrackFrozen ||
            replayTarget.clipLocked !== noteTransformReplayGuard.expectedClipLocked
        ) {
            return 'conflict';
        }
        if (
            noteTransformReplayGuard.expectedTempo !== undefined &&
            transportStore.value?.tempo !== noteTransformReplayGuard.expectedTempo
        ) {
            return 'conflict';
        }
    }
    const storedNotes = projectedNotes ?? state.notesByClipId[clipId];
    const storedNotesPresent = projectedNotesBucketPresent ?? Object.hasOwn(state.notesByClipId, clipId);
    if (
        expectedNotesBucketPresent !== undefined &&
        (notesBucketPresent === undefined || storedNotesPresent !== expectedNotesBucketPresent)
    ) {
        return 'conflict';
    }
    const canTreatMissingAsEmpty =
        expectedNotesBucketPresent === undefined &&
        storedNotes === undefined &&
        allowMissingExpectedEmpty &&
        expectedNotes.length === 0;
    if (storedNotes === undefined && !canTreatMissingAsEmpty && expectedNotesBucketPresent === undefined) {
        return 'conflict';
    }
    const currentNotes = storedNotes ?? [];
    if (
        midiNotesEqual(currentNotes, notes) &&
        (notesBucketPresent === undefined || storedNotesPresent === notesBucketPresent)
    ) {
        return 'no-write';
    }
    return midiNotesEqual(currentNotes, expectedNotes) ? 'written' : 'conflict';
}
