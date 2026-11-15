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
    type TrackAlternativeRetiredClipsSnapshot,
} from '../../events/arrangementTrackAppActions';
import { getHeldClips } from '../../models/TrackAlternativeClips';
import {
    normalizeClipSatelliteEntry,
    readClipSatelliteEntry,
    writeClipSatelliteEntry,
} from '../../stores/clipSatelliteState';
import { clipAutomationLaneTransitionMatchesStore } from '../../useCases/clip/clipAutomationLaneTransitionMatchesStore';
import { removeClipSatelliteData } from '../../useCases/clip/removeClipSatelliteData';

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

/** The rows the live stores hold for `clipIds`, lanes with their store index. */
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
    return {
        clipIds: [...clipIds],
        midiNotesByClipId: pick(midi?.notesByClipId),
        midiCcByClipId: pick(midi?.ccByClipId),
        midiPitchBendByClipId: pick(midi?.pitchBendByClipId),
        clipSatellites: clipIds
            .map((clipId) => readClipSatelliteEntry(clipId))
            .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null),
        clipAutomationLanes,
    };
}

/** The same clip ids holding no rows: what the stores hold once the delete ran. */
export function emptyRetiredClips(clipIds: readonly string[]): TrackAlternativeRetiredClipsSnapshot {
    return {
        clipIds: [...clipIds],
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        clipSatellites: [],
        clipAutomationLanes: [],
    };
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
 * both sides name the same clips, the live stores hold exactly `expected` for
 * them, and no lane `replacement` adds back collides with a live lane id.
 */
export function retiredClipsTransitionIsAdmissible(
    expected: TrackAlternativeRetiredClipsSnapshot,
    replacement: TrackAlternativeRetiredClipsSnapshot
): boolean {
    return (
        valuesEqual(expected.clipIds, replacement.clipIds) &&
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
