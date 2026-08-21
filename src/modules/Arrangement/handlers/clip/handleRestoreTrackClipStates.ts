import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { applyClipAutomationLaneTransition } from '../../useCases/clip/applyClipAutomationLaneTransition';
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

/**
 * Nothing this snapshot names has diverged from live state. `Array.every` is
 * vacuously true on `[]`, so a `true` here never means "live state was verified" —
 * only "no named track disagrees". That is why it is never the whole guard: `execute`
 * additionally requires every track it writes to be named by `expected`, which is what
 * stops an empty or partial `expected` from authorising anything.
 */
function everyEntryMatchesLiveState(entries: readonly TrackClipStateSnapshot[]): boolean {
    return entries.every((entry) =>
        clipIdSequenceMatches(
            entry.trackId,
            entry.clips.map((clip) => clip.id)
        )
    );
}

function clipIdsOf(entry: TrackClipStateSnapshot): string[] {
    const ids = new Set(entry.clips.map((clip) => clip.id));
    for (const lane of entry.clipAutomationLanes) {
        if (lane.clipId !== undefined) {
            ids.add(lane.clipId);
        }
    }
    for (const satellite of entry.clipSatellites) {
        ids.add(satellite.clipId);
    }
    return [...ids];
}

/**
 * Restore one track. Writes `clips` together with every track-level field a
 * collection rewrite overwrites: restoring clips alone would hand back the right
 * clips on a track that had lost its kind, its device chain, its frozen take and
 * its alternative lanes.
 */
function writeTrackClipState(entry: TrackClipStateSnapshot): void {
    // The snapshot's `clips`, `devices` and `alternatives` structurally satisfy their
    // declared element types while actually carrying the whole cloned objects — the
    // same convention `handleRestoreClip` casts through for a single clip.
    updateTrack(entry.trackId, (track) => ({
        ...track,
        clips: entry.clips as never,
        kind: entry.trackFields.kind,
        devices: entry.trackFields.devices as never,
        frozen: entry.trackFields.frozen,
        frozenBufferId: entry.trackFields.frozenBufferId,
        freezeState: entry.trackFields.freezeState,
        activeAlternativeId: entry.trackFields.activeAlternativeId,
        alternatives: entry.trackFields.alternatives as never,
    }));

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

    for (const satellite of entry.clipSatellites) {
        writeClipSatelliteEntry(satellite);
    }
}

/**
 * General guarded restore for whole-track clip-collection rewrites (cut, paste,
 * flatten, consolidate). Every named track's live clip id sequence must still
 * match `expected` before anything is written — a single divergent track refuses
 * the entire batch, because a partial restore is exactly the lost update this
 * handler exists to prevent.
 *
 * The guard is two halves and needs both: every `expected` entry matches live state,
 * and every `replacement` entry is named by `expected`. The second is what makes an
 * empty or short `expected` unable to authorise anything — `Array.every` alone is
 * vacuously true on `[]`, and a `replacement` track nobody checked is an unguarded
 * overwrite of whatever is live there now.
 *
 * Clip-scoped automation lanes go first and through `applyClipAutomationLaneTransition`,
 * which is atomic and verifies its own writes by re-reading the store. Ordering it
 * ahead of the track writes means a refusal there has written nothing at all; doing
 * the track writes first would leave clips restored and their automation gone.
 *
 * `undoable: false` — invoked only by undo/redo machinery; must not itself
 * create a new undo entry.
 */
export const handleRestoreTrackClipStates = createHandler<'restoreTrackClipStates'>({
    execute: (action) => {
        if (!everyEntryMatchesLiveState(action.payload.expected)) {
            return { status: 'conflict' };
        }

        const expectedByTrackId = new Map(action.payload.expected.map((entry) => [entry.trackId, entry]));
        for (const entry of action.payload.replacement) {
            const expectedEntry = expectedByTrackId.get(entry.trackId);
            if (!expectedEntry) {
                // A replacement track with no expected counterpart was never guarded,
                // so nothing proved its live automation is what the snapshot assumes.
                return { status: 'conflict' };
            }
            const affectedClipIds = [...new Set([...clipIdsOf(expectedEntry), ...clipIdsOf(entry)])];
            if (
                !applyClipAutomationLaneTransition(
                    affectedClipIds,
                    expectedEntry.clipAutomationLanes,
                    entry.clipAutomationLanes
                )
            ) {
                return { status: 'conflict' };
            }
        }

        for (const entry of action.payload.replacement) {
            writeTrackClipState(entry);
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip state', inverseAction: null }),
    // Vacuous truth is the wanted answer on this side: an action naming no track to
    // restore has nothing to do, and reporting that keeps it off `execute`, which would
    // refuse it as unguarded and leave a conflicted entry sitting at the top of the undo
    // stack refusing every later press.
    isNoop: (action) => everyEntryMatchesLiveState(action.payload.replacement),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
