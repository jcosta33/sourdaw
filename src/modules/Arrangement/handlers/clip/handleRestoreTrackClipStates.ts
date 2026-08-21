import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

/**
 * A snapshot's clip id sequence still matches the live track: same clips, same
 * order. Compared by id sequence rather than deep equality — a deep compare
 * would spuriously conflict on recomputed fields, while an id-sequence
 * compare is what actually detects a clip added, removed, split or reordered
 * since the snapshot was captured.
 */
function clipIdSequenceMatches(trackId: string, expectedClipIds: readonly string[]): boolean {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return false;
    }
    const liveClipIds = track.clips.map((clip) => clip.id);
    if (liveClipIds.length !== expectedClipIds.length) {
        return false;
    }
    return liveClipIds.every((clipId, index) => clipId === expectedClipIds[index]);
}

function entriesMatchLiveState(entries: readonly TrackClipStateSnapshot[]): boolean {
    return entries.every((entry) =>
        clipIdSequenceMatches(
            entry.trackId,
            entry.clips.map((clip) => clip.id)
        )
    );
}

function writeTrackClipState(entry: TrackClipStateSnapshot): void {
    // The snapshot's `clips` structurally satisfies `ClipSnapshot` (its declared
    // element type) while actually carrying the whole cloned `Clip` object —
    // the same convention `handleRestoreClip` casts through for a single clip.
    updateTrack(entry.trackId, (track) => ({ ...track, clips: entry.clips as never }));

    const midiClipIds = new Set([
        ...Object.keys(entry.midiNotesByClipId),
        ...Object.keys(entry.midiCcByClipId),
        ...Object.keys(entry.midiPitchBendByClipId),
    ]);
    for (const clipId of midiClipIds) {
        restoreMidiClipData({
            clipId,
            notesSnapshot: entry.midiNotesByClipId[clipId] ?? null,
            controlChangeSnapshot: entry.midiCcByClipId[clipId] ?? null,
            pitchBendSnapshot: entry.midiPitchBendByClipId[clipId] ?? null,
        });
    }
}

/**
 * General guarded restore for whole-track clip-collection rewrites (cut,
 * paste, strip silence, and future collection-rewriting handlers). Every
 * named track's live clip id sequence must still match `expected` before
 * anything is written — a single divergent track refuses the entire batch,
 * because a partial restore is exactly the lost update this handler exists to
 * prevent.
 *
 * `undoable: false` — invoked only by undo/redo machinery; must not itself
 * create a new undo entry.
 */
export const handleRestoreTrackClipStates = createHandler<'restoreTrackClipStates'>({
    execute: (action) => {
        if (!entriesMatchLiveState(action.payload.expected)) {
            return { status: 'conflict' };
        }
        for (const entry of action.payload.replacement) {
            writeTrackClipState(entry);
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip state', inverseAction: null }),
    isNoop: (action) => entriesMatchLiveState(action.payload.replacement),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
