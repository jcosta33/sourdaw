import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { type MidiAppAction } from '../../events/midiAppActions';
import { type MidiClipNoteSnapshot } from '../../events/midiClipDataSnapshots';
import { midiStore } from '../../stores/midiStore';
import { isRestoreMidiClipNotesReplayArguments } from '../../transformers/isRestoreMidiClipNotesReplayArguments';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';
import { findEditableBaseMidiClip } from '../midiNoteCrud/findEditableBaseMidiClip';

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
    noteTransformReplayGuard?: Extract<
        MidiAppAction,
        { type: 'restoreMidiClipNotes' }
    >['payload']['noteTransformReplayGuard'];
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
    let target: NoteTransformReplayTarget | undefined;
    for (const track of trackStore.value?.tracks ?? []) {
        for (const clip of track.clips) {
            if (clip.id !== clipId) {
                continue;
            }
            if (target) {
                return undefined;
            }
            if (track.id !== trackId || track.kind !== 'midi' || clip.type !== 'midi') {
                return undefined;
            }
            target = {
                trackId: track.id,
                trackFrozen: track.frozen === true,
                clipLocked: clip.locked === true,
            };
        }
    }
    return target;
}

function noteTransformReplayMatches({
    clipId,
    noteTransformReplayGuard: guard,
    projectedNoteTransformReplayTarget,
}: Pick<
    GetRestoreMidiClipNotesStatusInput,
    'clipId' | 'noteTransformReplayGuard' | 'projectedNoteTransformReplayTarget'
>): boolean {
    if (!guard) {
        return true;
    }
    if (guard.requiresEditableBaseClip && !findEditableBaseMidiClip(clipId, guard.trackId)) {
        return false;
    }
    const target = projectedNoteTransformReplayTarget ?? readLiveNoteTransformReplayTarget(guard.trackId, clipId);
    return (
        target !== undefined &&
        target.trackId === guard.trackId &&
        target.trackFrozen === guard.expectedTrackFrozen &&
        target.clipLocked === guard.expectedClipLocked &&
        (guard.expectedTempo === undefined || transportStore.value?.tempo === guard.expectedTempo)
    );
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
            noteTransformReplayGuard,
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
    if (!noteTransformReplayMatches({ clipId, noteTransformReplayGuard, projectedNoteTransformReplayTarget })) {
        return 'conflict';
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
