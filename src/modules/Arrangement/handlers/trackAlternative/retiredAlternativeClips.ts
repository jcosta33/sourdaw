import {
    getAutomationLanes,
    removeAutomationLane,
    restoreAutomationLanesAtPositions,
} from '#/modules/Automation/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { decodeMidiClipDataSnapshots, removeMidiClipData, restoreMidiClipData } from '#/modules/MIDI/useCases';
import { type ClipAutomationLaneSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import {
    type PositionedClipAutomationLaneSnapshot,
    type PositionedTakeLaneSnapshot,
    type TrackAlternativeRetiredClipsSnapshot,
} from '../../events/arrangementTrackAppActions';
import { type TakeLane } from '../../models/TakeLane';
import { getHeldClips } from '../../models/TrackAlternativeClips';
import {
    normalizeClipSatelliteEntry,
    readClipSatelliteEntry,
    writeClipSatelliteEntry,
} from '../../stores/clipSatelliteState';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { clipAutomationLaneTransitionMatchesStore } from '../../useCases/clip/clipAutomationLaneTransitionMatchesStore';
import { removeClipSatelliteData } from '../../useCases/clip/removeClipSatelliteData';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';

type HeldClipsTrack = {
    activeAlternativeId: string;
    clips: { id: string }[];
    alternatives: { id: string; clips: { id: string }[] }[];
};

/**
 * The clip ids a delete retires: every clip the track held before the write that
 * no track holds after it. Read through `getHeldClips`, so the active
 * alternative's stale stored copy never counts — a clip it still names after
 * the clip moved to another track is that track's, and stays.
 */
export function findRetiredClipIds(trackBefore: HeldClipsTrack, tracksAfter: readonly HeldClipsTrack[]): string[] {
    const heldAfter = new Set(tracksAfter.flatMap((track) => getHeldClips(track).map((clip) => clip.id)));
    const heldBefore = new Set(getHeldClips(trackBefore).map((clip) => clip.id));
    return Array.from(heldBefore).filter((id) => !heldAfter.has(id));
}

/** The named take lanes as the take-lane store holds them now, with their index. */
export function readTakeLanes(laneIds: readonly string[]): PositionedTakeLaneSnapshot[] {
    const ids = new Set(laneIds);
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane, laneIndex) =>
        ids.has(lane.id) ? [{ laneIndex, lane: structuredClone(lane) }] : []
    );
}

/**
 * The rows the live stores hold for `clipIds`, lanes with their store index.
 * The take lanes are the ones `removeTakesForClips` would rewrite or drop for
 * these clips, captured whole.
 */
export function captureRetiredClips(clipIds: readonly string[]): TrackAlternativeRetiredClipsSnapshot {
    const ids = new Set(clipIds);
    const midi = midiStore.value;
    const pick = (byClipId: Readonly<Record<string, readonly { readonly id: string }[]>> | undefined) =>
        Object.fromEntries(
            clipIds.flatMap((clipId) => {
                const rows = byClipId?.[clipId];
                return rows ? [[clipId, structuredClone(rows)]] : [];
            })
        );
    const clipAutomationLanes: PositionedClipAutomationLaneSnapshot[] = getAutomationLanes().flatMap((lane, index) =>
        lane.clipId !== undefined && ids.has(lane.clipId) ? [{ index, lane: structuredClone(lane) }] : []
    );
    const takeLaneIds = captureRetiredTakeLanes(clipIds).map((retired) => retired.lane.id);
    return {
        clipIds: [...clipIds],
        midiNotesByClipId: pick(midi?.notesByClipId),
        midiCcByClipId: pick(midi?.ccByClipId),
        midiPitchBendByClipId: pick(midi?.pitchBendByClipId),
        clipSatellites: clipIds
            .map((clipId) => readClipSatelliteEntry(clipId))
            .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null),
        clipAutomationLanes,
        takeLaneIds,
        takeLanes: readTakeLanes(takeLaneIds),
    };
}

/**
 * The same clips holding no rows, with the named take lanes as the store holds
 * them: what the stores hold once the delete ran, so read after its writes.
 */
export function settledRetiredClips(
    clipIds: readonly string[],
    takeLaneIds: readonly string[]
): TrackAlternativeRetiredClipsSnapshot {
    return {
        clipIds: [...clipIds],
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        clipSatellites: [],
        clipAutomationLanes: [],
        takeLaneIds: [...takeLaneIds],
        takeLanes: readTakeLanes(takeLaneIds),
    };
}

function takeLanesMatchLive(snapshot: TrackAlternativeRetiredClipsSnapshot): boolean {
    const liveLanes = takeLaneStore.value?.lanes ?? [];
    return snapshot.takeLaneIds.every((laneId) =>
        valuesEqual(
            liveLanes.find((lane) => lane.id === laneId),
            snapshot.takeLanes.find((entry) => entry.lane.id === laneId)?.lane
        )
    );
}

/**
 * A track holds at most one take lane, so a lane the restore would insert
 * collides with a lane a peer gave the same track in the meantime.
 */
function takeLaneInsertCollides(snapshot: TrackAlternativeRetiredClipsSnapshot): boolean {
    const named = new Set(snapshot.takeLaneIds);
    const foreignTrackIds = new Set(
        (takeLaneStore.value?.lanes ?? []).filter((lane) => !named.has(lane.id)).map((lane) => lane.trackId)
    );
    return snapshot.takeLanes.some((entry) => foreignTrackIds.has(entry.lane.trackId));
}

function decodedTakeLanes(snapshot: TrackAlternativeRetiredClipsSnapshot): TakeLane[] | null {
    return decodeExactTakeLaneSnapshots(snapshot.takeLanes.map((entry) => entry.lane));
}

function lanesOf(snapshot: TrackAlternativeRetiredClipsSnapshot): ClipAutomationLaneSnapshot[] {
    return snapshot.clipAutomationLanes.map((entry) => entry.lane);
}

function hasMidi(snapshot: TrackAlternativeRetiredClipsSnapshot, clipId: string): boolean {
    return (
        Object.hasOwn(snapshot.midiNotesByClipId, clipId) ||
        Object.hasOwn(snapshot.midiCcByClipId, clipId) ||
        Object.hasOwn(snapshot.midiPitchBendByClipId, clipId)
    );
}

function midiMatchesLive(snapshot: TrackAlternativeRetiredClipsSnapshot): boolean {
    const midi = midiStore.value;
    return snapshot.clipIds.every(
        (clipId) =>
            valuesEqual(midi?.notesByClipId[clipId], snapshot.midiNotesByClipId[clipId]) &&
            valuesEqual(midi?.ccByClipId[clipId], snapshot.midiCcByClipId[clipId]) &&
            valuesEqual(midi?.pitchBendByClipId[clipId], snapshot.midiPitchBendByClipId[clipId])
    );
}

function expectedSatelliteEntry(snapshot: TrackAlternativeRetiredClipsSnapshot, clipId: string) {
    const captured = snapshot.clipSatellites.find((entry) => entry.clipId === clipId);
    if (captured) {
        return normalizeClipSatelliteEntry(captured);
    }
    return { clipId, gainEnvelope: null, warpState: null };
}

function satellitesMatchLive(snapshot: TrackAlternativeRetiredClipsSnapshot): boolean {
    return snapshot.clipIds.every((clipId) =>
        valuesEqual(readClipSatelliteEntry(clipId), expectedSatelliteEntry(snapshot, clipId))
    );
}

function midiIsRestorable(snapshot: TrackAlternativeRetiredClipsSnapshot): boolean {
    return snapshot.clipIds.every(
        (clipId) =>
            decodeMidiClipDataSnapshots({
                notesSnapshot: snapshot.midiNotesByClipId[clipId] ?? null,
                controlChangeSnapshot: snapshot.midiCcByClipId[clipId] ?? null,
                pitchBendSnapshot: snapshot.midiPitchBendByClipId[clipId] ?? null,
            }) !== null
    );
}

/**
 * Whether a restore may move these clips' rows from `expected` to `replacement`:
 * both sides name the same clips and take lanes, the live stores hold exactly
 * `expected` for them, no automation lane `replacement` adds back collides with
 * a live lane id, and no take lane it puts back collides with another lane on
 * its track.
 */
export function retiredClipsTransitionIsAdmissible(
    expected: TrackAlternativeRetiredClipsSnapshot,
    replacement: TrackAlternativeRetiredClipsSnapshot
): boolean {
    return (
        valuesEqual(expected.clipIds, replacement.clipIds) &&
        valuesEqual(expected.takeLaneIds, replacement.takeLaneIds) &&
        decodedTakeLanes(replacement) !== null &&
        takeLanesMatchLive(expected) &&
        !takeLaneInsertCollides(replacement) &&
        midiIsRestorable(replacement) &&
        midiMatchesLive(expected) &&
        satellitesMatchLive(expected) &&
        clipAutomationLaneTransitionMatchesStore(expected.clipIds, lanesOf(expected), lanesOf(replacement))
    );
}

/**
 * Lanes first: putting lanes back is the only write that can refuse, and it
 * refuses whole, so a `false` here has written nothing.
 */
export function applyRetiredClipLanes(
    expected: TrackAlternativeRetiredClipsSnapshot,
    replacement: TrackAlternativeRetiredClipsSnapshot
): boolean {
    const expectedIds = new Set(expected.clipAutomationLanes.map((entry) => entry.lane.id));
    const replacementIds = new Set(replacement.clipAutomationLanes.map((entry) => entry.lane.id));
    if (
        !restoreAutomationLanesAtPositions(
            replacement.clipAutomationLanes.filter((entry) => !expectedIds.has(entry.lane.id))
        )
    ) {
        return false;
    }
    for (const entry of expected.clipAutomationLanes) {
        if (!replacementIds.has(entry.lane.id)) {
            removeAutomationLane(entry.lane.id);
        }
    }
    return true;
}

/** MIDI rows and satellites, after `applyRetiredClipLanes` admitted the move. */
export function applyRetiredClipRows(
    expected: TrackAlternativeRetiredClipsSnapshot,
    replacement: TrackAlternativeRetiredClipsSnapshot
): void {
    const droppedMidi = expected.clipIds.filter((clipId) => hasMidi(expected, clipId) && !hasMidi(replacement, clipId));
    removeMidiClipData(droppedMidi);
    for (const clipId of replacement.clipIds) {
        restoreMidiClipData({
            clipId,
            notesSnapshot: replacement.midiNotesByClipId[clipId] ?? null,
            controlChangeSnapshot: replacement.midiCcByClipId[clipId] ?? null,
            pitchBendSnapshot: replacement.midiPitchBendByClipId[clipId] ?? null,
        });
    }

    const restoredSatelliteIds = new Set(replacement.clipSatellites.map((entry) => entry.clipId));
    for (const entry of replacement.clipSatellites) {
        writeClipSatelliteEntry(entry);
    }
    for (const entry of expected.clipSatellites) {
        if (!restoredSatelliteIds.has(entry.clipId)) {
            writeClipSatelliteEntry({ clipId: entry.clipId, gainEnvelope: null, warpState: null });
        }
    }
    // The forward delete's own sweep for every clip that leaves again, which
    // also lets go of the ephemeral drag-preview and recording refs. A clip
    // that keeps a lane is not leaving, so the sweep must not reach its lanes.
    const lanedClipIds = new Set(replacement.clipAutomationLanes.map((entry) => entry.lane.clipId));
    removeClipSatelliteData(
        replacement.clipIds.filter(
            (clipId) => !restoredSatelliteIds.has(clipId) && !lanedClipIds.has(clipId) && !hasMidi(replacement, clipId)
        )
    );
}

/**
 * The named take lanes become exactly what `replacement` holds, each at its
 * captured index; every other lane is left where it is. Run only after
 * `retiredClipsTransitionIsAdmissible` admitted the move.
 */
export function applyRetiredTakeLanes(
    expected: TrackAlternativeRetiredClipsSnapshot,
    replacement: TrackAlternativeRetiredClipsSnapshot
): void {
    const state = takeLaneStore.value;
    const restored = decodedTakeLanes(replacement);
    if (!state || !restored || (expected.takeLanes.length === 0 && replacement.takeLanes.length === 0)) {
        return;
    }
    const named = new Set(replacement.takeLaneIds);
    const lanes = state.lanes.filter((lane) => !named.has(lane.id));
    const placed = replacement.takeLanes
        .map((entry, position) => ({ laneIndex: entry.laneIndex, lane: restored[position]! }))
        .toSorted((left, right) => left.laneIndex - right.laneIndex);
    for (const { laneIndex, lane } of placed) {
        lanes.splice(Math.min(Math.max(laneIndex, 0), lanes.length), 0, lane);
    }
    takeLaneStore.set({ lanes });
}
