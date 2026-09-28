import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { type TakeReKeyClipWindow, type TakeReKeyLaneTransition } from './takeReKeyTransition';

type CaptureTakeReKeyTransitionsInput = {
    /** Per-track clip fragment windows from `collectTakeReKeyWindows`; lanes on unlisted tracks are untouched. */
    windowsByTrackId: ReadonlyMap<string, readonly TakeReKeyClipWindow[]>;
    /** Clip ids the same operation removes outright — their takes retire separately (#4520), never re-key. */
    removedClipIds: ReadonlySet<string>;
    deleteStartBeat: number;
    deleteEndBeat: number;
};

type MappedPiece = {
    startBeat: number;
    endBeat: number;
    targetClipId: string;
    preImageStartBeat: number;
    preImageEndBeat: number;
    deltaBeats: number;
};

/** One fragment a take survives as, in the shape a comp region maps through. */
type TakeFragmentMap = {
    takeId: string;
    preImageStartBeat: number;
    preImageEndBeat: number;
    deltaBeats: number;
};

/**
 * The portion of [startBeat, endBeat) outside the deleted span, mapped through
 * the surviving windows of the range's clip. Material inside the deletion has
 * no window and never reappears; a portion no window covers — stale take or
 * region geometry the clip never carried — is dropped rather than left to
 * overhang.
 */
function mapRangeThroughWindows(
    startBeat: number,
    endBeat: number,
    windows: readonly TakeReKeyClipWindow[],
    deleteStartBeat: number,
    deleteEndBeat: number
): MappedPiece[] {
    const pieces: MappedPiece[] = [];
    for (const window of windows) {
        const deltaBeats = window.targetStartBeat - window.sourceStartBeat;
        const overlapStart = Math.max(startBeat, window.sourceStartBeat);
        const overlapEnd = Math.min(endBeat, window.sourceEndBeat);
        // A genuine window never straddles the deleted span — the route's own
        // geometry cut it there — but a stale range handed to this derivation
        // can: the deleted material is gone no matter what it overlaps, so the
        // span comes out of the overlap before the shift applies.
        const survivingRanges: [number, number][] = [];
        const leftEnd = Math.min(overlapEnd, deleteStartBeat);
        if (overlapStart < leftEnd) {
            survivingRanges.push([overlapStart, leftEnd]);
        }
        const rightStart = Math.max(overlapStart, deleteEndBeat);
        if (rightStart < overlapEnd) {
            survivingRanges.push([rightStart, overlapEnd]);
        }
        for (const [rangeStart, rangeEnd] of survivingRanges) {
            pieces.push({
                startBeat: rangeStart + deltaBeats,
                endBeat: rangeEnd + deltaBeats,
                targetClipId: window.targetClipId,
                preImageStartBeat: rangeStart,
                preImageEndBeat: rangeEnd,
                deltaBeats,
            });
        }
    }
    return pieces;
}

function mintFragmentTakeId(
    takeId: string,
    deleteStartBeat: number,
    deleteEndBeat: number,
    usedIds: Set<string>
): string {
    const baseId = `${takeId}:time-delete-right:${deleteStartBeat}:${deleteEndBeat}`;
    let candidate = baseId;
    let suffix = 1;
    while (usedIds.has(candidate)) {
        candidate = `${baseId}:${suffix}`;
        suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
}

function areSameTakeGeometry(take: Take, piece: MappedPiece): boolean {
    return piece.targetClipId === take.clipId && piece.startBeat === take.startBeat && piece.endBeat === take.endBeat;
}

function regionsOverlap(left: CompRegion, right: CompRegion): boolean {
    return left.startBeat < right.endBeat && right.startBeat < left.endBeat;
}

/**
 * Keep the store's exactness law on the derived regions — sorted by start,
 * non-overlapping, every region naming a take the lane still holds. The
 * derivation is monotone by construction, so this pass only absorbs stale
 * caller-side geometry (a region wider than its take, a take whose span ends
 * inside the deletion).
 */
function normalizeDerivedRegions(regions: readonly CompRegion[], takeIds: ReadonlySet<string>): CompRegion[] {
    const sorted = [...regions].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);
    const retained: CompRegion[] = [];
    for (const region of sorted) {
        if (region.endBeat <= region.startBeat || !takeIds.has(region.takeId)) {
            continue;
        }
        const previous = retained[retained.length - 1];
        if (previous && regionsOverlap(previous, region)) {
            continue;
        }
        retained.push(region);
    }
    return retained;
}

/**
 * Read-only half of the take re-key: how one delete-time operation moves every
 * take and comp region on the tracks it rewrites, captured before any store
 * publishes (#4841).
 *
 * A take follows its clip's surviving windows: the deleted span's portion is
 * gone, the rest lands where the operation put the clip — re-keyed onto the
 * migration target when the clip survives under a fresh id, split into one
 * take per fragment when the clip splits (the left fragment keeps the take's
 * id, matching the split convention that the left half keeps the clip id),
 * shifted or trimmed in place when the clip keeps its id. `sourceOffsetBeats`
 * rides along untouched: the fragment clips carry the consumed head in their
 * own offset fields, so the take's pass offset means the same as before.
 * A take whose whole span the deletion consumed is dropped — its material is
 * no longer in the arrangement — and every capture rides the transition record
 * so undo puts it back.
 *
 * Comp regions map through their take's fragments, re-pointing at the fragment
 * take, so a region never keeps advancing the comp cursor over material its
 * take no longer covers.
 */
type LaneTakeMapping = {
    takesAfter: Take[];
    fragmentsBySourceTakeId: Map<string, TakeFragmentMap[]>;
    takesChanged: boolean;
};

function groupWindowsByClipId(windows: readonly TakeReKeyClipWindow[]): Map<string, TakeReKeyClipWindow[]> {
    const windowsByClipId = new Map<string, TakeReKeyClipWindow[]>();
    for (const window of windows) {
        const clipWindows = windowsByClipId.get(window.sourceClipId);
        if (clipWindows) {
            clipWindows.push(window);
        } else {
            windowsByClipId.set(window.sourceClipId, [window]);
        }
    }
    for (const clipWindows of windowsByClipId.values()) {
        clipWindows.sort((alpha, buffer) => alpha.sourceStartBeat - buffer.sourceStartBeat);
    }
    return windowsByClipId;
}

/**
 * One take's surviving pieces as fragment takes and the region-mapping view of
 * the same split. The leftmost fragment keeps the take's id — the split
 * convention — so regions naming it keep resolving, and the minted fragment
 * ids derive deterministically from the take id and the deleted span: a
 * replayed redo re-mints the same ids, exactly like the clip identities it
 * replays.
 */
function buildTakeFragments(
    take: Take,
    pieces: readonly MappedPiece[],
    deleteStartBeat: number,
    deleteEndBeat: number,
    usedTakeIds: Set<string>
): { fragmentTakes: Take[]; fragments: TakeFragmentMap[] } {
    const fragmentTakes: Take[] = [];
    const fragments: TakeFragmentMap[] = [];
    for (const [pieceIndex, piece] of pieces.entries()) {
        let fragmentTakeId = take.id;
        if (pieceIndex !== 0) {
            fragmentTakeId = mintFragmentTakeId(take.id, deleteStartBeat, deleteEndBeat, usedTakeIds);
        }
        fragmentTakes.push({
            ...take,
            id: fragmentTakeId,
            clipId: piece.targetClipId,
            startBeat: piece.startBeat,
            endBeat: piece.endBeat,
        });
        fragments.push({
            takeId: fragmentTakeId,
            preImageStartBeat: piece.preImageStartBeat,
            preImageEndBeat: piece.preImageEndBeat,
            deltaBeats: piece.deltaBeats,
        });
    }
    return { fragmentTakes, fragments };
}

function mapLaneTakes(
    lane: TakeLane,
    windowsByClipId: ReadonlyMap<string, TakeReKeyClipWindow[]>,
    input: CaptureTakeReKeyTransitionsInput,
    usedTakeIds: Set<string>
): LaneTakeMapping {
    const mapping: LaneTakeMapping = {
        takesAfter: [],
        fragmentsBySourceTakeId: new Map<string, TakeFragmentMap[]>(),
        takesChanged: false,
    };
    for (const take of lane.takes) {
        if (input.removedClipIds.has(take.clipId)) {
            // The retirement leg owns this take; the transition carries it
            // verbatim on both sides so the reconcile never moves it.
            mapping.takesAfter.push(take);
            continue;
        }
        const takeWindows = windowsByClipId.get(take.clipId);
        if (!takeWindows) {
            mapping.takesAfter.push(take);
            continue;
        }
        const pieces = mapRangeThroughWindows(
            take.startBeat,
            take.endBeat,
            takeWindows,
            input.deleteStartBeat,
            input.deleteEndBeat
        );
        if (pieces.length === 1 && areSameTakeGeometry(take, pieces[0]!)) {
            mapping.takesAfter.push(take);
            continue;
        }

        mapping.takesChanged = true;
        const { fragmentTakes, fragments } = buildTakeFragments(
            take,
            pieces,
            input.deleteStartBeat,
            input.deleteEndBeat,
            usedTakeIds
        );
        mapping.takesAfter.push(...fragmentTakes);
        mapping.fragmentsBySourceTakeId.set(take.id, fragments);
    }
    return mapping;
}

/** One region, remapped through its take's fragments onto the fragment takes. */
function mapRegionThroughFragments(region: CompRegion, fragments: readonly TakeFragmentMap[]): CompRegion[] {
    const mapped: CompRegion[] = [];
    for (const fragment of fragments) {
        const overlapStart = Math.max(region.startBeat, fragment.preImageStartBeat);
        const overlapEnd = Math.min(region.endBeat, fragment.preImageEndBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }
        mapped.push({
            startBeat: overlapStart + fragment.deltaBeats,
            endBeat: overlapEnd + fragment.deltaBeats,
            takeId: fragment.takeId,
        });
    }
    return mapped;
}

function mapLaneRegions(
    lane: TakeLane,
    fragmentsBySourceTakeId: ReadonlyMap<string, TakeFragmentMap[]>,
    removedClipIds: ReadonlySet<string>
): { regionsAfter: CompRegion[]; regionsChanged: boolean } {
    const regionsAfter: CompRegion[] = [];
    let regionsChanged = false;
    for (const region of lane.activeCompRegions) {
        const take = lane.takes.find((candidate) => candidate.id === region.takeId);
        const fragments = take ? fragmentsBySourceTakeId.get(take.id) : undefined;
        if (!take || removedClipIds.has(take.clipId) || !fragments) {
            regionsAfter.push(region);
            continue;
        }
        const mapped = mapRegionThroughFragments(region, fragments);
        if (
            mapped.length === 1 &&
            mapped[0]!.takeId === region.takeId &&
            mapped[0]!.startBeat === region.startBeat &&
            mapped[0]!.endBeat === region.endBeat
        ) {
            regionsAfter.push(region);
            continue;
        }
        regionsChanged = true;
        regionsAfter.push(...mapped);
    }
    return { regionsAfter, regionsChanged };
}

export function captureTakeReKeyTransitions(
    input: CaptureTakeReKeyTransitionsInput
): readonly TakeReKeyLaneTransition[] {
    const state = takeLaneStore.value;
    if (!state || input.windowsByTrackId.size === 0) {
        return [];
    }

    const usedTakeIds = new Set<string>();
    for (const lane of state.lanes) {
        for (const take of lane.takes) {
            usedTakeIds.add(take.id);
        }
    }

    const transitions: TakeReKeyLaneTransition[] = [];
    for (const [laneIndex, lane] of state.lanes.entries()) {
        const windows = input.windowsByTrackId.get(lane.trackId);
        if (!windows) {
            continue;
        }
        const takeMapping = mapLaneTakes(lane, groupWindowsByClipId(windows), input, usedTakeIds);
        const regionMapping = mapLaneRegions(lane, takeMapping.fragmentsBySourceTakeId, input.removedClipIds);
        if (!takeMapping.takesChanged && !regionMapping.regionsChanged) {
            continue;
        }
        const takeIdsAfter = new Set(takeMapping.takesAfter.map((take) => take.id));
        transitions.push({
            laneIndex,
            laneId: lane.id,
            trackId: lane.trackId,
            takesBefore: lane.takes,
            takesAfter: takeMapping.takesAfter,
            regionsBefore: lane.activeCompRegions,
            regionsAfter: normalizeDerivedRegions(regionMapping.regionsAfter, takeIdsAfter),
        });
    }
    return transitions;
}
