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
    /**
     * What the windows represent, and with it how regions on takes the windows
     * do not fragment behave. `delete-time` (default): the timeline compressed
     * around the span, so a stale-wide region's in-span body is gone and its
     * tail survives only where nothing rehomed under it. `clip-transform`
     * (#5100, #5048): the operation only moved or split the clips the windows
     * name — nothing was deleted and nothing rehomed under an untouched clip,
     * so those regions ride both sides verbatim; trimming them at the span
     * would edit a comp the operation never touched.
     */
    operationKind?: 'delete-time' | 'clip-transform';
};

type MappedPiece = {
    startBeat: number;
    endBeat: number;
    targetClipId: string;
    preImageStartBeat: number;
    preImageEndBeat: number;
};

type BeatWindow = {
    sourceStartBeat: number;
    sourceEndBeat: number;
    targetStartBeat: number;
    targetEndBeat: number;
};

/** One fragment a take survives as, in the shape a comp region maps through. */
type TakeFragmentMap = BeatWindow & { takeId: string };

function mapBeatThroughWindow(beat: number, window: BeatWindow): number {
    if (beat === window.sourceStartBeat) {
        return window.targetStartBeat;
    }
    if (beat === window.sourceEndBeat) {
        return window.targetEndBeat;
    }
    if (window.sourceStartBeat === window.targetStartBeat) {
        return beat;
    }
    return Math.min(window.targetEndBeat, window.targetStartBeat + (beat - window.sourceStartBeat));
}

/**
 * The portion of [startBeat, endBeat) covered by the surviving windows of the
 * range's clip, mapped to the post-delete timeline. Window membership alone
 * settles survival: the routes cut their windows at the deleted span, so no
 * window straddles it, and a portion no window covers — deleted material, or
 * stale take geometry the clip never carried — is dropped rather than left to
 * overhang.
 */
function mapRangeThroughWindows(
    startBeat: number,
    endBeat: number,
    windows: readonly TakeReKeyClipWindow[]
): MappedPiece[] {
    const pieces: MappedPiece[] = [];
    for (const window of windows) {
        const overlapStart = Math.max(startBeat, window.sourceStartBeat);
        const overlapEnd = Math.min(endBeat, window.sourceEndBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }
        pieces.push({
            startBeat: mapBeatThroughWindow(overlapStart, window),
            endBeat: mapBeatThroughWindow(overlapEnd, window),
            targetClipId: window.targetClipId,
            preImageStartBeat: overlapStart,
            preImageEndBeat: overlapEnd,
        });
    }
    return pieces;
}

function areSameTakeGeometry(take: Take, piece: MappedPiece): boolean {
    return piece.targetClipId === take.clipId && piece.startBeat === take.startBeat && piece.endBeat === take.endBeat;
}

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
 * convention — so regions naming it keep resolving. A take mints at most one
 * id: its clip contributes at most two windows (its own surviving fragment and
 * the re-keyed right one) and a window at most one piece, so the second piece
 * is the only mint, over a base id the source take's id makes unique. Deriving
 * it from the take id and the deleted span keeps a replayed redo re-minting
 * the same id, exactly like the clip identities it replays. Uniqueness rests
 * on take ids being unique — true for every lane an app route mints, but not
 * enforced by the store's sanitize: two takes sharing an id on corrupt
 * hydrated state would mint colliding fragment ids here, an accepted
 * divergence on state no route produces.
 */
function buildTakeFragments(
    take: Take,
    pieces: readonly MappedPiece[],
    deleteStartBeat: number,
    deleteEndBeat: number
): { fragmentTakes: Take[]; fragments: TakeFragmentMap[] } {
    const fragmentTakes: Take[] = [];
    const fragments: TakeFragmentMap[] = [];
    for (const [pieceIndex, piece] of pieces.entries()) {
        let fragmentTakeId = take.id;
        if (pieceIndex !== 0) {
            // For a delete-time operation the span is the deleted range; for a
            // clip transform (#5048) it is the split beat on both sides. Either
            // way the fields are the operation's exact edges, so a replayed redo
            // re-mints the same id.
            fragmentTakeId = `${take.id}:time-delete-right:${deleteStartBeat}:${deleteEndBeat}`;
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
            sourceStartBeat: piece.preImageStartBeat,
            sourceEndBeat: piece.preImageEndBeat,
            targetStartBeat: piece.startBeat,
            targetEndBeat: piece.endBeat,
        });
    }
    return { fragmentTakes, fragments };
}

function mapLaneTakes(
    lane: TakeLane,
    windowsByClipId: ReadonlyMap<string, TakeReKeyClipWindow[]>,
    input: CaptureTakeReKeyTransitionsInput
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
        const pieces = mapRangeThroughWindows(take.startBeat, take.endBeat, takeWindows);
        if (pieces.length === 1 && areSameTakeGeometry(take, pieces[0]!)) {
            mapping.takesAfter.push(take);
            continue;
        }

        mapping.takesChanged = true;
        const { fragmentTakes, fragments } = buildTakeFragments(
            take,
            pieces,
            input.deleteStartBeat,
            input.deleteEndBeat
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
        const overlapStart = Math.max(region.startBeat, fragment.sourceStartBeat);
        const overlapEnd = Math.min(region.endBeat, fragment.sourceEndBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }
        mapped.push({
            startBeat: mapBeatThroughWindow(overlapStart, fragment),
            endBeat: mapBeatThroughWindow(overlapEnd, fragment),
            takeId: fragment.takeId,
        });
    }
    return mapped;
}

type LaneRegionMapping = {
    regionsBefore: CompRegion[];
    regionsAfter: CompRegion[];
    regionsChanged: boolean;
};

function mapLaneRegions(
    lane: TakeLane,
    takesById: ReadonlyMap<string, Take>,
    fragmentsBySourceTakeId: ReadonlyMap<string, TakeFragmentMap[]>,
    input: CaptureTakeReKeyTransitionsInput,
    rightSideUnmoved: boolean
): LaneRegionMapping {
    const mapping: LaneRegionMapping = { regionsBefore: [], regionsAfter: [], regionsChanged: false };
    for (const region of lane.activeCompRegions) {
        const take = takesById.get(region.takeId);
        if (take && input.removedClipIds.has(take.clipId)) {
            // The retirement leg owns this region's removal (#4520), so it
            // never reaches regionsAfter: carried there it would collide with
            // a survivor's remapped region on the freed span, and whichever
            // the lane held first would destroy the other (#4841). It still
            // rides regionsBefore — the lane genuinely held it — so the
            // restore leg can put it back once the survivor's region has moved
            // off the span (the retirement's own restore runs while the
            // survivor still occupies it and refuses the overlap). No
            // regionsChanged: a lane whose only change is this region belongs
            // to the retirement leg alone.
            mapping.regionsBefore.push(region);
            continue;
        }
        const fragments = take ? fragmentsBySourceTakeId.get(take.id) : undefined;
        if (!fragments) {
            // Clip-transform semantics: nothing was deleted and nothing rehomed
            // under an untouched clip, so its regions ride both sides verbatim —
            // the transform must not edit a comp it never touched.
            if (input.operationKind === 'clip-transform') {
                mapping.regionsBefore.push(region);
                mapping.regionsAfter.push(region);
                continue;
            }
            // The take's clip was untouched (or the region names a take the
            // lane does not hold, which only an unsanitized write can
            // produce), so the region rides the before side verbatim — the
            // lane genuinely held it, and the restore leg puts exactly it
            // back. The after side cannot carry it verbatim: a region wider
            // than its take is a shape the store tolerates, and its overhang
            // can reach into the deleted span, where it would overlap the
            // regions remapped onto the freed span — leaving the after side
            // unlawful for the plan's own validator. The after side keeps the
            // portion left of the span; the portion inside the span claims
            // deleted material and is gone on either route. The portion right
            // of the span survives verbatim only when no window on the track
            // shifted — the conservative proxy for nothing rehomed under it:
            // any shifted window drops the tail, whether or not the shift
            // reaches it.
            mapping.regionsBefore.push(region);
            // Two shapes are already correct on the after side and ride it
            // verbatim — the region object itself, recording no change and
            // emitting no no-op transition: a region ending at or left of
            // the span (its overhang never reaches deleted material), and a
            // region wholly right of the span on a track where nothing
            // shifted.
            if (
                region.endBeat <= input.deleteStartBeat ||
                (rightSideUnmoved && region.startBeat >= input.deleteEndBeat)
            ) {
                mapping.regionsAfter.push(region);
                continue;
            }
            mapping.regionsChanged = true;
            if (region.startBeat < input.deleteStartBeat) {
                mapping.regionsAfter.push({
                    startBeat: region.startBeat,
                    endBeat: input.deleteStartBeat,
                    takeId: region.takeId,
                });
            }
            if (rightSideUnmoved && region.endBeat > input.deleteEndBeat) {
                // Partial tail: the span consumed the region's body, so the
                // surviving right portion is a fresh literal. It starts at
                // the span's right edge exactly — the verbatim guard above
                // already continued every region starting at or past it, so
                // region.startBeat < input.deleteEndBeat here.
                mapping.regionsAfter.push({
                    startBeat: input.deleteEndBeat,
                    endBeat: region.endBeat,
                    takeId: region.takeId,
                });
            }
            continue;
        }
        const mapped = mapRegionThroughFragments(region, fragments);
        mapping.regionsBefore.push(region);
        if (
            mapped.length === 1 &&
            mapped[0]!.takeId === region.takeId &&
            mapped[0]!.startBeat === region.startBeat &&
            mapped[0]!.endBeat === region.endBeat
        ) {
            mapping.regionsAfter.push(region);
            continue;
        }
        mapping.regionsChanged = true;
        mapping.regionsAfter.push(...mapped);
    }
    return mapping;
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
 * take no longer covers. A region whose take's clip the operation removes
 * outright belongs to the paired retirement (#4520): it rides the before side
 * verbatim — so the restore leg can put it back — but never the after side,
 * where it would collide with a survivor's remapped region on the freed span.
 * A region whose take's clip was untouched rides the before side verbatim
 * too; the after side keeps the portion left of the deleted span, drops the
 * in-span portion (it claims deleted material) on either route, and keeps the
 * right-of-span portion verbatim only when no window on the track shifted —
 * the conservative proxy for nothing having been rehomed under it. Any
 * shifted window drops the tail, whether or not the shift reaches it: the
 * capture does not prove per tail that the shift stays clear, and a verbatim
 * tail could overhang rehomed material. The clamp exists because the store
 * tolerates a region wider than its take, so the overhang could otherwise
 * reach into the freed span and overlap the regions remapped onto it.
 * The derived sides keep the store's exactness law by
 * construction: the lane's regions start sorted and non-overlapping, each
 * region's fragments stay in window order, and the per-side deltas are uniform
 * (left material keeps its beats; everything right of the span shifts by the
 * same amount), so the mapped sides come out sorted, non-overlapping, and
 * naming only takes the same side holds.
 */
export function captureTakeReKeyTransitions(
    input: CaptureTakeReKeyTransitionsInput
): readonly TakeReKeyLaneTransition[] {
    const state = takeLaneStore.value;
    if (!state || input.windowsByTrackId.size === 0) {
        return [];
    }

    const transitions: TakeReKeyLaneTransition[] = [];
    for (const lane of state.lanes) {
        const windows = input.windowsByTrackId.get(lane.trackId);
        if (!windows) {
            continue;
        }
        // Take ids are unique on every lane an app route can produce
        // (`createTake` mints a fresh UUID per take), which is what makes this
        // index a faithful per-id lookup. The store's sanitize does not
        // dedupe, so corrupt hydrated or merged state could hold duplicates:
        // the Map then keeps the last entry where a linear scan would find
        // the first — an accepted divergence on state no route produces.
        const takesById = new Map(lane.takes.map((take) => [take.id, take]));
        const takeMapping = mapLaneTakes(lane, groupWindowsByClipId(windows), input);
        // Movement test, not route identity: true when no window on the
        // track shifted — always the case on the excise route, which leaves
        // the gap, and also on a ripple delete that moved nothing right of
        // the span (a trim-only ripple). A stale-wide region's right-of-span
        // tail survives verbatim only then; any shifted window drops it (see
        // mapLaneRegions).
        const rightSideUnmoved = windows.every((window) => window.targetStartBeat === window.sourceStartBeat);
        const regionMapping = mapLaneRegions(
            lane,
            takesById,
            takeMapping.fragmentsBySourceTakeId,
            input,
            rightSideUnmoved
        );
        if (!takeMapping.takesChanged && !regionMapping.regionsChanged) {
            continue;
        }
        transitions.push({
            laneId: lane.id,
            trackId: lane.trackId,
            takesBefore: lane.takes,
            takesAfter: takeMapping.takesAfter,
            regionsBefore: regionMapping.regionsBefore,
            regionsAfter: regionMapping.regionsAfter,
        });
    }
    return transitions;
}
