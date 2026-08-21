import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import {
    type DeviceSnapshot,
    type TrackClipStateSnapshot,
    type TrackCollectionAlternativeSnapshot,
    type TrackCollectionFieldsSnapshot,
} from '#/utils/handlerContract';

import { writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type Device, type Track, type TrackAlternative } from '../../stores/trackStore';
import { applyClipAutomationLaneTransition } from '../../useCases/clip/applyClipAutomationLaneTransition';
import { freezeStateSnapshotMatches } from '../../useCases/freezeBounce/freezeStateSnapshotMatches';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

/**
 * Two clip collections hold the same clips in the same order. Compared by id
 * sequence rather than deep equality — a deep compare would spuriously conflict on
 * recomputed fields, while an id-sequence compare is what actually detects a clip
 * added, removed, split or reordered since the snapshot was captured.
 */
function clipIdSequenceMatches(
    liveClips: readonly { readonly id: string }[] | undefined,
    expectedClips: readonly { readonly id: string }[] | undefined
): boolean {
    const live = liveClips ?? [];
    const expected = expectedClips ?? [];
    if (live.length !== expected.length) {
        return false;
    }
    return live.every((clip, index) => clip.id === expected[index]?.id);
}

/**
 * `undefined` is admitted on both sides on purpose. `normalizeTrack` passes `devices`
 * and `alternatives` through untouched, so a row loaded from an older project can be
 * missing `parameterValues` or an alternative's `clips` entirely. Throwing on that
 * inside a guard would turn a divergence check into a crash in the middle of undo;
 * treating an absent map as empty compares it against the equally absent snapshot.
 */
function parameterValuesMatch(
    live: Readonly<Record<string, number>> | undefined,
    expected: Readonly<Record<string, number>> | undefined
): boolean {
    const liveValues = live ?? {};
    const expectedValues = expected ?? {};
    const liveKeys = Object.keys(liveValues);
    if (liveKeys.length !== Object.keys(expectedValues).length) {
        return false;
    }
    return liveKeys.every((key) => Object.is(liveValues[key], expectedValues[key]));
}

/**
 * Identity comparison for one device, in the shape `freezeStateSnapshotMatches` uses:
 * compare what the user authored — which device, whether it is bypassed, what its
 * parameters read — and not the opaque host-owned blobs. `externalStateChunk` and
 * `deviceState` are refetched from a live plugin instance without any user edit, so a
 * deep compare on them would report a conflict against state nothing meaningfully
 * changed, exactly the way a deep clip compare would.
 */
function deviceMatches(live: Device, expected: DeviceSnapshot): boolean {
    return (
        live.id === expected.id &&
        live.type === expected.type &&
        live.bypassed === expected.bypassed &&
        parameterValuesMatch(live.parameterValues, expected.parameterValues)
    );
}

function devicesMatch(live: readonly Device[], expected: readonly DeviceSnapshot[]): boolean {
    if (live.length !== expected.length) {
        return false;
    }
    // Positional, so a reorder of the same devices conflicts: chain order is the
    // signal path, and restoring a stale order is as destructive as dropping a device.
    return live.every((device, index) => {
        const expectedDevice = expected[index];
        return expectedDevice !== undefined && deviceMatches(device, expectedDevice);
    });
}

function alternativesMatch(
    live: readonly TrackAlternative[],
    expected: readonly TrackCollectionAlternativeSnapshot[]
): boolean {
    if (live.length !== expected.length) {
        return false;
    }
    return live.every((alternative, index) => {
        const expectedAlternative = expected[index];
        return (
            expectedAlternative !== undefined &&
            alternative.id === expectedAlternative.id &&
            clipIdSequenceMatches(alternative.clips, expectedAlternative.clips)
        );
    });
}

function freezeAggregateMatches(track: Track, expected: TrackCollectionFieldsSnapshot): boolean {
    return freezeStateSnapshotMatches(track, {
        frozen: expected.frozen,
        ...(expected.frozenBufferId === undefined ? {} : { frozenBufferId: expected.frozenBufferId }),
        freezeState: expected.freezeState,
    });
}

/**
 * One comparator per field `writeTrackClipState` overwrites, keyed by
 * `TrackCollectionFieldsSnapshot`'s own keys with `-?` so every optional one is
 * required here too. This mapping is the point: a field added to the snapshot — and
 * therefore to the write — does not compile until it is compared, which is what stops
 * the guard from silently falling behind what it authorises. `frozen`,
 * `frozenBufferId` and `freezeState` share one comparator because the freeze state is
 * only meaningful as an aggregate.
 */
type TrackFieldComparators = {
    readonly [Key in keyof TrackCollectionFieldsSnapshot]-?: (
        track: Track,
        expected: TrackCollectionFieldsSnapshot
    ) => boolean;
};

const TRACK_FIELD_COMPARATORS: TrackFieldComparators = {
    kind: (track, expected) => track.kind === expected.kind,
    devices: (track, expected) => devicesMatch(track.devices, expected.devices),
    frozen: freezeAggregateMatches,
    frozenBufferId: freezeAggregateMatches,
    freezeState: freezeAggregateMatches,
    activeAlternativeId: (track, expected) => track.activeAlternativeId === expected.activeAlternativeId,
    alternatives: (track, expected) => alternativesMatch(track.alternatives, expected.alternatives),
};

/**
 * The live track still holds everything this snapshot is about to overwrite: the
 * clip id sequence *and* every track-level field. Both halves are load-bearing.
 * `cutClip` and `pasteClip` touch only clips, so their snapshots carry track fields
 * the forward path never rewrote — guarding on clips alone would let undo silently
 * hand back a stale device chain, freeze take or alternative set that a collaborator
 * changed in between. The four callers all capture `expected` as the post-write
 * state, so on an undivergent undo these fields already agree and the stricter
 * comparison costs them nothing.
 */
function entryMatchesLiveState(entry: TrackClipStateSnapshot): boolean {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === entry.trackId);
    if (!track) {
        return false;
    }
    if (!clipIdSequenceMatches(track.clips, entry.clips)) {
        return false;
    }
    return Object.values(TRACK_FIELD_COMPARATORS).every((matches) => matches(track, entry.trackFields));
}

/**
 * Nothing this snapshot names has diverged from live state. `Array.every` is
 * vacuously true on `[]`, so a `true` here never means "live state was verified" —
 * only "no named track disagrees". That is why it is never the whole guard: `execute`
 * additionally requires every track it writes to be named by `expected`, which is what
 * stops an empty or partial `expected` from authorising anything.
 */
function everyEntryMatchesLiveState(entries: readonly TrackClipStateSnapshot[]): boolean {
    return entries.every((entry) => entryMatchesLiveState(entry));
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
 * flatten, consolidate). Every named track must still match `expected` on
 * everything the write replaces — its clip id sequence and every track-level field
 * `writeTrackClipState` overwrites — before anything is written. A single divergent
 * track refuses the entire batch, because a partial restore is exactly the lost
 * update this handler exists to prevent.
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
