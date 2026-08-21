import { midiStore } from '#/modules/MIDI/stores';
import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import {
    type ClipSatelliteEntrySnapshot,
    type ClipStateSnapshot,
    type DeviceSnapshot,
    type DeviceStateChunkSnapshot,
    type TrackClipStateSnapshot,
    type TrackCollectionAlternativeSnapshot,
    type TrackCollectionFieldsSnapshot,
} from '#/utils/handlerContract';

import { readClipSatelliteEntry, writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type Clip, type Device, type Track, type TrackAlternative } from '../../stores/trackStore';
import { applyClipAutomationLaneTransition } from '../../useCases/clip/applyClipAutomationLaneTransition';
import { freezeStateSnapshotMatches } from '../../useCases/freezeBounce/freezeStateSnapshotMatches';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural compare over a JSON-shaped payload — the whole-value equality test for
 * anything this restore replaces outright rather than field by field.
 *
 * Safe to recurse without a cycle guard, and that safety is a property of the inputs
 * rather than of this function. Every value that reaches it is either a live store
 * value or a `structuredClone` of one taken moments earlier, and each of those stores
 * admits only JSON-safe scalars, arrays and plain records:
 * `normalize_device_state_value` in `trackStore` for a device-state chunk, the MIDI
 * store's own key validation for notes, and `readClipSatelliteEntry`'s normalizers for
 * a clip's satellites. Nothing here can be self-referential or a class instance.
 *
 * `Object.is` at the leaves rather than `===`, matching `parameterValuesMatch`. The
 * two values being compared are always in-session — an undo entry does not outlive
 * the project load that cleared the history — so neither side has been through the
 * JSON round trip that would normalize `-0` to `0`, and no arithmetic in the model
 * produces `NaN`. The distinction cannot arise without an author, which is the only
 * property this guard needs from it.
 */
function structuralValueMatches(live: unknown, expected: unknown): boolean {
    if (Array.isArray(live) || Array.isArray(expected)) {
        if (!Array.isArray(live) || !Array.isArray(expected) || live.length !== expected.length) {
            return false;
        }
        return live.every((entry, index) => structuralValueMatches(entry, expected[index]));
    }
    if (isPlainRecord(live) || isPlainRecord(expected)) {
        if (!isPlainRecord(live) || !isPlainRecord(expected)) {
            return false;
        }
        const liveKeys = Object.keys(live);
        if (liveKeys.length !== Object.keys(expected).length) {
            return false;
        }
        return liveKeys.every((key) => structuralValueMatches(live[key], expected[key]));
    }
    return Object.is(live, expected);
}

/**
 * A field this guard deliberately does not compare. Returning `true` unconditionally
 * is the point: the field stays in its comparator table, so the mapped type still
 * refuses to compile when a new one appears, while recording that this particular one
 * must never be allowed to refuse an undo. Every use carries its reason beside it.
 */
const notCompared = (): boolean => true;

/**
 * One comparator per field `writeTrackClipState` replaces on a clip, keyed by `Clip`'s
 * own keys with `-?` so an added field does not compile until somebody decides how it
 * is compared. That gate is the entire reason this is a table rather than a deep
 * equality call.
 *
 * Comparing clip *contents* — not just the id sequence — is what this restore
 * actually needs. `updateClipInStore` replaces a clip in place at its existing index,
 * so every single-clip edit in the product leaves the id sequence byte-identical: a
 * guard that reads no further authorises overwriting position, length, gain, fades,
 * lock, colour, stretch, loop and retune state with the pre-operation values, and
 * reports it as a clean restore.
 *
 * The comparison is safe to make this wide because every field below is *authored*.
 * Three properties establish that, and all three had to hold:
 *
 * 1. No clip field is default-filled on the way in. `Clip` has no counterpart to
 *    `normalizeTrack`: `normalize_clip` in `trackStore` and `hydrateClip` in the
 *    `.sdaw` loader both copy an optional field only when it is already present and
 *    never synthesize one. So an absent field stays absent on both sides, and there
 *    is no load-time fill for a comparator to trip over.
 * 2. Nothing recomputes a clip field on a schedule, a render pass or a subscription.
 *    `buildTimelineRenderModel` reads these fields into a view model and writes none
 *    of them back — including `isLinkedInstance`, which it derives from
 *    `parentClipId` for display only. The one derived store write is
 *    `propagateParentChanges`, pushing a parent's `midiOffsetBeats` onto a linked
 *    instance: a real change to project truth that the restore would undo, so
 *    conflicting on it is correct, and it is gated behind an inequality test so it
 *    cannot churn.
 * 3. The writes that land asynchronously still carry an authored change. A recording
 *    buffer resolving onto `audioBufferId`, and a Knead pitch analysis resolving onto
 *    `kneadState`, both arrive on a later tick — but each follows from the musician
 *    arming and recording, or opening the Knead editor on that clip, and each leaves
 *    permanent project truth the restore would silently revert.
 *
 * That matters because the cost of over-refusing is worse than the loss being fixed:
 * `undo` leaves a conflicted entry on `past` and reports nothing to the user, so a
 * comparator that trips on churn nobody authored kills undo for the rest of the
 * session with every older edit stranded behind it.
 */
type ClipFieldComparators = {
    readonly [Key in keyof Clip]-?: (live: Clip, expected: ClipStateSnapshot) => boolean;
};

const CLIP_FIELD_COMPARATORS: ClipFieldComparators = {
    id: (live, expected) => live.id === expected.id,
    trackId: (live, expected) => live.trackId === expected.trackId,
    name: (live, expected) => live.name === expected.name,
    startBeat: (live, expected) => live.startBeat === expected.startBeat,
    endBeat: (live, expected) => live.endBeat === expected.endBeat,
    type: (live, expected) => live.type === expected.type,
    audioBufferId: (live, expected) => live.audioBufferId === expected.audioBufferId,
    assetHash: (live, expected) => live.assetHash === expected.assetHash,
    audioOffsetBeats: (live, expected) => live.audioOffsetBeats === expected.audioOffsetBeats,
    midiOffsetBeats: (live, expected) => live.midiOffsetBeats === expected.midiOffsetBeats,
    fadeInBeats: (live, expected) => live.fadeInBeats === expected.fadeInBeats,
    fadeOutBeats: (live, expected) => live.fadeOutBeats === expected.fadeOutBeats,
    gain: (live, expected) => live.gain === expected.gain,
    color: (live, expected) => live.color === expected.color,
    locked: (live, expected) => live.locked === expected.locked,
    muted: (live, expected) => live.muted === expected.muted,
    stretchMode: (live, expected) => live.stretchMode === expected.stretchMode,
    stretchRatio: (live, expected) => live.stretchRatio === expected.stretchRatio,
    loopEnabled: (live, expected) => live.loopEnabled === expected.loopEnabled,
    loopLength: (live, expected) => live.loopLength === expected.loopLength,
    followAction: (live, expected) => live.followAction === expected.followAction,
    generating: (live, expected) => live.generating === expected.generating,
    isGhost: (live, expected) => live.isGhost === expected.isGhost,
    // Excluded: a view toggle that happens to be persisted, not clip content.
    // `toggleInlineEditing` flips it when the musician opens the in-place MIDI editor
    // on a clip, which is an ordinary thing to be doing on one clip of a track while
    // undoing an edit to another. Restoring a stale value closes an editor — visible,
    // and one click to reopen. Refusing the undo instead costs the whole undo stack,
    // silently, and that trade is never worth making for an editor's open state.
    isInlineEditing: notCompared,
    parentClipId: (live, expected) => live.parentClipId === expected.parentClipId,
    isLinkedInstance: (live, expected) => live.isLinkedInstance === expected.isLinkedInstance,
    sourceKeyRoot: (live, expected) => live.sourceKeyRoot === expected.sourceKeyRoot,
    sourceScaleName: (live, expected) => live.sourceScaleName === expected.sourceScaleName,
    overrides: (live, expected) => structuralValueMatches(live.overrides, expected.overrides),
    // Structural rather than field-by-field, because the live value is wider than the
    // model declares: `updateClipKneadState` writes the Knead module's own
    // `KneadClipState`, which carries tolerance and per-blob fields `ClipKneadState`
    // does not name. Comparing only the declared fields would miss exactly the retune
    // edits this is here to protect, since Knead's writes do not go through
    // `executeAppAction` and file no undo entry of their own.
    //
    // Compared only when the snapshot carries one, and that half-comparison is the
    // whole point. A clip acquires a `kneadState` merely by being *selected* while the
    // Knead editor is the open audio-edit mode: the editor mounts on whatever clip the
    // selection store names, its effect fires the pitch analysis for a clip with no
    // blobs, and `updateClipKneadState` seeds a default payload for a clip that had no
    // state at all — a fresh object every time, so its no-op short-circuit cannot fire.
    // Comparing an absent snapshot value against that seeded default refuses the undo,
    // and `undo` leaves the conflicted entry on `past` reporting nothing, so the whole
    // stack dies on the most ordinary vocal-editing gesture in the product.
    //
    // Skipping the comparison costs the musician nothing, because the snapshot has no
    // `kneadState` to restore either: `restoredClips` leaves the live value in place
    // rather than writing the absence back. A snapshot that *does* carry one is a
    // genuine retune the restore would throw away, and still conflicts.
    kneadState: (live, expected) =>
        expected.kneadState === undefined || structuralValueMatches(live.kneadState, expected.kneadState),
};

/**
 * Two clip collections hold the same clips, in the same order, with the same contents.
 * Positional and length-checked first, so an added, removed, split or reordered clip
 * still conflicts exactly as it did when this compared ids alone.
 */
function clipsMatch(
    liveClips: readonly Clip[] | undefined,
    expectedClips: readonly ClipStateSnapshot[] | undefined
): boolean {
    const live = liveClips ?? [];
    const expected = expectedClips ?? [];
    if (live.length !== expected.length) {
        return false;
    }
    return live.every((clip, index) => {
        const expectedClip = expected[index];
        if (expectedClip === undefined) {
            return false;
        }
        return Object.values(CLIP_FIELD_COMPARATORS).every((matches) => matches(clip, expectedClip));
    });
}

/**
 * `undefined` is admitted on both sides defensively rather than because a live device
 * is expected to lack the map — `normalizeTrack`'s device normalization always writes
 * one. Throwing inside a guard would turn a divergence check into a crash in the
 * middle of undo, and treating an absent map as empty still conflicts against a
 * populated one because the key count is compared first.
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

function deviceStateMatches(
    live: DeviceStateChunkSnapshot | undefined,
    expected: DeviceStateChunkSnapshot | undefined
): boolean {
    if (live === undefined || expected === undefined) {
        return live === expected;
    }
    return live.version === expected.version && structuralValueMatches(live.data, expected.data);
}

/**
 * Identity comparison for one device, in the shape `freezeStateSnapshotMatches` uses:
 * compare what the user authored and this restore replaces, and skip only what a
 * later save recomputes anyway.
 *
 * `deviceState` is compared, and is the reason this is not a shorter list. It is
 * authored project truth — the built-in state a device serialises for itself when
 * `parameterValues` cannot express it — written only by the `setDeviceState` action
 * behind the device commits, and recomputed by nothing. That action is
 * `undoable: false`, so such an edit leaves no undo entry to protect it; if this
 * guard skipped the field, undoing an unrelated clip edit would silently reinstate
 * the previous payload and the loss would only surface the next time the project was
 * opened and rehydrated from it.
 *
 * `externalPluginId` and `externalInstanceId` are compared for the same reason as the
 * rest: they are a device's plugin-host identity, minted once by `addExternalDevice`
 * when the musician loads the plugin and never rewritten in place afterwards — the
 * only other writers mint a whole new device (preset load, template load, track
 * duplicate). Nothing recomputes them on a tick, so comparing them cannot trip on
 * churn, and restoring a stale pair would point a live device at the wrong plugin
 * instance.
 *
 * `externalStateChunk` is the one exclusion, and it is genuinely different: it is
 * refetched at save time from the still-live native plugin instance, so a stale value
 * written back here is overwritten before it can reach disk, while a deep compare on
 * it would conflict against churn no user authored.
 */
function deviceMatches(live: Device, expected: DeviceSnapshot): boolean {
    return (
        live.id === expected.id &&
        live.name === expected.name &&
        live.type === expected.type &&
        live.bypassed === expected.bypassed &&
        live.externalPluginId === expected.externalPluginId &&
        live.externalInstanceId === expected.externalInstanceId &&
        parameterValuesMatch(live.parameterValues, expected.parameterValues) &&
        deviceStateMatches(live.deviceState, expected.deviceState)
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

/**
 * One comparator per field of a take lane, keyed by `TrackAlternative`'s own keys with
 * `-?`, for exactly the reason the clip, track and snapshot tables above and below are
 * tables: the restore replaces the whole `alternatives` array, so every field on a lane
 * is a field it overwrites, and one added later must not become writable before
 * somebody decides how the guard sees it.
 *
 * This element was the one hop in the chain without that gate — hand-written over a
 * subset while its three neighbours were mapped — and `name` is what fell through it.
 */
type AlternativeFieldComparators = {
    readonly [Key in keyof TrackAlternative]-?: (
        live: TrackAlternative,
        expected: TrackCollectionAlternativeSnapshot
    ) => boolean;
};

const ALTERNATIVE_FIELD_COMPARATORS: AlternativeFieldComparators = {
    id: (live, expected) => live.id === expected.id,
    // `renameTrackAlternative` is an ordinary `undoable: true` user action that writes
    // this and nothing else, and the restore puts the captured name back with the rest
    // of the cloned lane. Uncompared, undoing a cut silently reverts a take lane a
    // collaborator renamed in between, reports the restore as written, and propagates
    // the revert back through the CRDT.
    name: (live, expected) => live.name === expected.name,
    clips: (live, expected) => clipsMatch(live.clips, expected.clips),
};

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
            Object.values(ALTERNATIVE_FIELD_COMPARATORS).every((matches) => matches(alternative, expectedAlternative))
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
 * One clip's MIDI lane, compared against the live store.
 *
 * Keyed by what the snapshot carries rather than by what the track holds, so a clip
 * whose lane was empty at capture has no key here and is not compared — notes recorded
 * onto it since survive the restore untouched and must not refuse it.
 *
 * That reasoning is exact for this guard and deliberately incomplete for the handler,
 * and the gap is accepted rather than unnoticed. This and the three satellite guards
 * beside it read the *`expected`* entry's keys, while `writeTrackClipState` writes the
 * *`replacement`* entry's keys, and the two are independent captures taken at different
 * moments — so a key the replacement carries and `expected` does not is written without
 * this guard ever having looked at it. It is accepted because both entries come from
 * one `captureTrackClipStates` call over the same track ids and the same clip ids, so
 * their key sets diverge only where the forward operation itself added or removed a
 * lane, and no reachable loss was constructible from that. It is written down because
 * the containment is a property of the callers, not of this function, and a new caller
 * that captures the two sides over different clip sets breaks it silently.
 */
function midiLanesMatch(
    live: Readonly<Record<string, readonly unknown[]>> | undefined,
    expected: Readonly<Record<string, readonly { readonly id: string }[]>>
): boolean {
    return Object.keys(expected).every((clipId) => structuralValueMatches(live?.[clipId], expected[clipId]));
}

/**
 * Each captured satellite record against the live one for the same clip. Both sides
 * come out of `readClipSatelliteEntry`, which normalizes on read and drops absent
 * optional marker keys, so the two are structurally comparable by construction.
 */
function clipSatellitesMatch(expected: readonly ClipSatelliteEntrySnapshot[]): boolean {
    return expected.every((satellite) => structuralValueMatches(readClipSatelliteEntry(satellite.clipId), satellite));
}

/**
 * One guard per key of the snapshot, keyed by `TrackClipStateSnapshot`'s own keys with
 * `-?`. Same gate as the two comparator tables below it, one level up: a key added to
 * the snapshot is a key `writeTrackClipState` will write, and it does not compile
 * until this table says how the guard sees it.
 *
 * The table exists because the four MIDI and satellite keys were being written with no
 * comparator at all. `captureTrackClipStates` snapshots MIDI and satellites for *every*
 * clip id on the track — clips the operation never touched, and clips inside hidden
 * alternatives — and the restore writes all of them back. A note edited on a clip that
 * merely shares a track with the cut clip was therefore reverted by that cut's undo,
 * and reported as `written`.
 */
type SnapshotEntryGuards = {
    readonly [Key in keyof TrackClipStateSnapshot]-?: (track: Track, entry: TrackClipStateSnapshot) => boolean;
};

const SNAPSHOT_ENTRY_GUARDS: SnapshotEntryGuards = {
    trackId: (track, entry) => track.id === entry.trackId,
    clips: (track, entry) => clipsMatch(track.clips, entry.clips),
    // `cutClip` and `pasteClip` touch only clips, so their snapshots carry track fields
    // the forward path never rewrote — guarding on clips alone would let undo silently
    // hand back a stale device chain, freeze take or alternative set that a collaborator
    // changed in between.
    trackFields: (track, entry) =>
        Object.values(TRACK_FIELD_COMPARATORS).every((matches) => matches(track, entry.trackFields)),
    midiNotesByClipId: (_track, entry) => midiLanesMatch(midiStore.value?.notesByClipId, entry.midiNotesByClipId),
    midiCcByClipId: (_track, entry) => midiLanesMatch(midiStore.value?.ccByClipId, entry.midiCcByClipId),
    midiPitchBendByClipId: (_track, entry) =>
        midiLanesMatch(midiStore.value?.pitchBendByClipId, entry.midiPitchBendByClipId),
    clipSatellites: (_track, entry) => clipSatellitesMatch(entry.clipSatellites),
    // Excluded here because it is guarded elsewhere, not because it is unguarded:
    // `applyClipAutomationLaneTransition` compares live lanes against `expected` before
    // writing anything, and `execute` runs it ahead of every track write so a refusal
    // there has written nothing. Comparing it a second time here would only duplicate
    // that check against the same live state.
    clipAutomationLanes: notCompared,
};

/**
 * The live track still holds everything this snapshot is about to overwrite. The four
 * callers all capture `expected` as the post-write state, so on an undivergent undo
 * every one of these already agrees and the strict comparison costs them nothing.
 */
function entryMatchesLiveState(entry: TrackClipStateSnapshot): boolean {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === entry.trackId);
    if (!track) {
        return false;
    }
    return Object.values(SNAPSHOT_ENTRY_GUARDS).every((matches) => matches(track, entry));
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
 * Every live clip the track owns, keyed by id — the active collection and the take
 * lanes together, because `restoredClips` reconciles both and a clip moves between the
 * two when an alternative is switched.
 */
function liveClipsById(track: Track): Map<string, Clip> {
    const byId = new Map<string, Clip>();
    for (const clip of track.clips) {
        byId.set(clip.id, clip);
    }
    for (const alternative of track.alternatives) {
        for (const clip of alternative.clips) {
            byId.set(clip.id, clip);
        }
    }
    return byId;
}

/**
 * The clips to write, which is the snapshot's clips except for `kneadState`.
 *
 * That one field is not a wholesale replacement, and the asymmetry is the exact
 * counterpart of the one in `CLIP_FIELD_COMPARATORS.kneadState`: the guard declines to
 * compare a `kneadState` the snapshot does not carry, so this write must not put that
 * absence over a live value the guard was never asked about. Refusing to compare *and*
 * refusing to write is sound precisely because the snapshot has nothing there to lose —
 * leaving the live value alone restores exactly as much as writing `undefined` would,
 * and destroys nothing.
 *
 * No other field may be handled this way, and the reason is the same one read backwards:
 * every other field is compared, so writing it back is authorised by the guard that just
 * ran. Skipping a comparison without also skipping the write is a silent overwrite;
 * skipping a write for a field the snapshot genuinely carries is a silent failure to
 * restore. Only a field that is both absent and uncompared belongs here.
 */
function restoredClips(
    clips: readonly ClipStateSnapshot[],
    liveByClipId: ReadonlyMap<string, Clip>
): ClipStateSnapshot[] {
    return clips.map((clip) => {
        if (clip.kneadState !== undefined) {
            return clip;
        }
        const liveKneadState = liveByClipId.get(clip.id)?.kneadState;
        return liveKneadState === undefined ? clip : { ...clip, kneadState: liveKneadState };
    });
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
    updateTrack(entry.trackId, (track) => {
        const liveByClipId = liveClipsById(track);
        return {
            ...track,
            clips: restoredClips(entry.clips, liveByClipId) as never,
            kind: entry.trackFields.kind,
            devices: entry.trackFields.devices as never,
            frozen: entry.trackFields.frozen,
            frozenBufferId: entry.trackFields.frozenBufferId,
            freezeState: entry.trackFields.freezeState,
            activeAlternativeId: entry.trackFields.activeAlternativeId,
            // A take lane's clips go through the same reconciliation: `clipsMatch` is
            // what guards them, so the comparator's exclusion reaches here too.
            alternatives: entry.trackFields.alternatives.map((alternative) => ({
                ...alternative,
                clips: restoredClips(alternative.clips, liveByClipId),
            })) as never,
        };
    });

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
 * everything `everyEntryMatchesLiveState` compares, down to the contents of each
 * clip, before any track write lands. `SNAPSHOT_ENTRY_GUARDS` is where that
 * comparison is enforced rather than asserted — except for `clipAutomationLanes`,
 * which it deliberately leaves `notCompared`: that key has its own guard below.
 *
 * The guard is two halves and needs both: every `expected` entry matches live state,
 * and every `replacement` entry is named by `expected`. The second is what makes an
 * empty or short `expected` unable to authorise anything — `Array.every` alone is
 * vacuously true on `[]`, and a `replacement` track nobody checked is an unguarded
 * overwrite of whatever is live there now.
 *
 * Clip-scoped automation lanes are the second guard, applied per replacement entry
 * in one pass with `applyClipAutomationLaneTransition`, which both validates and
 * writes each entry's lanes before moving to the next. With two or more replacement
 * entries — `consolidateAllTracks` is multi-track by construction — an earlier
 * entry's automation writes can already be live when a later entry refuses,
 * returning `conflict` after this loop has mutated the store. That is not a defect
 * in this loop: `executeAppAction` runs `execute` inside an ambient storage
 * transaction and calls `storage_transaction.abort()` on a `conflict` result before
 * throwing, which walks back every pending write this synchronous call made,
 * including the earlier entries' automation. The all-or-nothing guarantee is real
 * but inherited from the caller, not produced locally by this loop's ordering —
 * reordering the loop, adding an early return, or introducing an `await` would
 * silently remove it while leaving this comment's claim intact. If this handler
 * ever needs the guarantee to hold locally instead, `restoreStripSilenceState` and
 * `restoreClipGlueState` show the route: pre-flight every entry with
 * `clipAutomationLaneTransitionMatchesStore` before applying any of them.
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
