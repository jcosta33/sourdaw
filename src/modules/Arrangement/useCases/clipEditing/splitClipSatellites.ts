import { getAutomationLanes, getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import { resolveBezierControls, subdivideBezierRightHalf } from '#/utils/automationCurve';
import { resolveLinkedLane } from '#/utils/automationLaneLink';

import { type WarpState } from '../../models/WarpMarker';
import { type ClipSatelliteEntry, readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type ClipGainEnvelope, type GainEnvelopePoint } from '../../stores/gainEnvelopeStore';
import { isDefaultWarpState } from '../../stores/warpStates';
import { readClipScopedAutomationLanes, type AutomationLaneValue } from '../clip/readClipScopedAutomationLanes';
import { sampleGainEnvelopePoints } from '../clipGainEnvelope/sampleGainEnvelopePoints';

/** Derived rather than imported: Automation owns the point model. */
type AutomationLanePoint = AutomationLaneValue['points'][number];

/**
 * The satellite half of a split plan: `previous` is what the stores hold before
 * the split (plus an explicit null entry for the right clip id, so an undo
 * clears the right half's satellites), `next` is what they hold after.
 */
export type ClipSplitSatellitePlan = {
    previous: ClipSatelliteEntry[];
    next: ClipSatelliteEntry[];
    /**
     * Copies of the source's clip-scoped automation lanes clamped to the right
     * fragment's window, keyed to the right clip id. The left half's lanes are
     * deliberately absent — the left keeps its id and its lanes untouched, so
     * there is nothing to capture or restore on that side.
     */
    rightAutomationLanes: AutomationLaneValue[];
};

type PrepareClipSplitSatellitesInput = {
    clipId: string;
    rightClipId: string;
    /** Cut position relative to the clip start — the gain envelope axis. */
    clipRelativeSplitBeats: number;
    /** Cut position in source content beats — the warp marker axis. */
    contentSplitBeats: number;
    /** Cut position on the absolute timeline — the clip automation axis. */
    absoluteSplitBeats: number;
};

type SplitGainEnvelopes = {
    left: ClipGainEnvelope | null;
    right: ClipGainEnvelope | null;
};

type SplitWarpStates = {
    left: WarpState | null;
    right: WarpState | null;
};

const NO_GAIN_ENVELOPES: SplitGainEnvelopes = { left: null, right: null };
const NO_WARP_STATES: SplitWarpStates = { left: null, right: null };

/**
 * Place a point without disturbing `beatOffset` order: `sampleGainEnvelopePoints`
 * walks adjacent pairs, so an out-of-order list reads as a different curve.
 */
function insertPointInOrder(points: GainEnvelopePoint[], point: GainEnvelopePoint): GainEnvelopePoint[] {
    const index = points.findIndex((candidate) => candidate.beatOffset > point.beatOffset);
    return index === -1 ? [...points, point] : [...points.slice(0, index), point, ...points.slice(index)];
}

/**
 * Both halves inherit the whole authored point set, the right half's copy
 * re-based by the split delta so a point still lines up with the moment of audio
 * it was drawn over. A point beyond a half's own edge is inert there, so keeping
 * it costs nothing and dropping it would destroy curve data the musician can
 * reach again by extending that edge back out (`rebaseGainEnvelope` in
 * `prepareStripSilence` states the same contract for the same class of edit).
 *
 * Each half also gets a synthetic seam point holding the curve's interpolated
 * value at the cut, so the split cannot change what the envelope sounded like. A
 * source point already sitting on the cut *is* that seam: a second point beside
 * it would make the interpolation span zero-width.
 */
function splitGainEnvelope(
    envelope: ClipGainEnvelope,
    { clipId, rightClipId, clipRelativeSplitBeats }: PrepareClipSplitSatellitesInput
): SplitGainEnvelopes {
    const seamGainDb = sampleGainEnvelopePoints(envelope.points, clipRelativeSplitBeats);
    const leftPoints = envelope.points.map((point) => ({ ...point }));
    const rightPoints = envelope.points.map((point) => ({
        ...point,
        beatOffset: point.beatOffset - clipRelativeSplitBeats,
    }));
    const seamIsAuthored = envelope.points.some((point) => point.beatOffset === clipRelativeSplitBeats);

    return {
        left: {
            clipId,
            enabled: envelope.enabled,
            points: seamIsAuthored
                ? leftPoints
                : insertPointInOrder(leftPoints, {
                      id: `gep-split-${rightClipId}-left`,
                      beatOffset: clipRelativeSplitBeats,
                      gainDb: seamGainDb,
                  }),
        },
        right: {
            clipId: rightClipId,
            enabled: envelope.enabled,
            points: seamIsAuthored
                ? rightPoints
                : insertPointInOrder(rightPoints, {
                      id: `gep-split-${rightClipId}-right`,
                      beatOffset: 0,
                      gainDb: seamGainDb,
                  }),
        },
    };
}

/**
 * Warp markers are keyed to *source content* beats (the elastic editor draws
 * them over the whole buffer), and the right clip's `audioOffsetBeats` grew by
 * the split, so markers keep their coordinates on both sides — the partition is
 * by content beat alone.
 */
function splitWarpState(warpState: WarpState, contentSplitBeats: number): SplitWarpStates {
    const left = {
        ...warpState,
        markers: warpState.markers.filter((marker) => marker.originalBeat < contentSplitBeats),
    };
    const right = {
        ...warpState,
        markers: warpState.markers.filter((marker) => marker.originalBeat >= contentSplitBeats),
    };
    // A half whose markers all left may collapse to the default state; that is no
    // satellite at all, not a record worth keeping (hasNonDefaultWarpState precedent).
    return {
        left: isDefaultWarpState(left) ? null : left,
        right: isDefaultWarpState(right) ? null : right,
    };
}

/**
 * The exact continuation of a straddling `bezier` segment, as the seam's cps.
 *
 * #4036 made the seam inherit the straddling segment's curve FAMILY, but a
 * `bezier` seam without cps plays the family-default quad — an audible change
 * whenever the musician authored control points. Subdividing the source quad
 * at the cut (`subdivideBezierRightHalf` — de Casteljau, parameter solved by
 * the evaluator's own Newton loop) yields the right half's inner controls: the
 * seam→next segment is then the same polynomial re-parameterized over the
 * remaining span, so the fragment plays, at every absolute beat, exactly what
 * the source played before the split. The seam's own `value` stays the
 * evaluator's live sample — the same curve at the same solved parameter, and
 * the one read that preserves the held-seam lane-range clamp semantics.
 *
 * Anything non-bezier returns no cps — those point models carry no cp fields,
 * and their seams are byte-identical to the pre-#4044 shape. A bezier whose
 * held value ends the lane (no next point) has no continuation to carry, and
 * a degenerate (zero-width or reversed) span has nothing the evaluator would
 * play — both return no cps rather than NaN.
 */
function bezierSeamControlPoints(
    lastLeft: AutomationLanePoint,
    nextPoint: AutomationLanePoint | undefined,
    absoluteSplitBeats: number
): Pick<AutomationLanePoint, 'cp1' | 'cp2'> {
    if (lastLeft.curve !== 'bezier' || nextPoint === undefined) {
        return {};
    }
    const beatSpan = nextPoint.beat - lastLeft.beat;
    if (beatSpan <= 0) {
        return {};
    }
    const cutFraction = (absoluteSplitBeats - lastLeft.beat) / beatSpan;
    const { cx1, cx2, cy1, cy2 } = resolveBezierControls({ firstPoint: lastLeft, secondPoint: nextPoint });
    const { cp1, cp2 } = subdivideBezierRightHalf({
        cx1,
        cx2,
        cy1,
        cy2,
        y0: lastLeft.value,
        y3: nextPoint.value,
        cutFraction,
    });
    return { cp1, cp2 };
}

/**
 * The seam point that pins the curve's interpolated value at the cut — the
 * lane analogue of `splitGainEnvelope`'s seam. Without it a segment straddling
 * the cut collapses to hold-first-value on the fragment: between the cut and
 * the first copied point the fragment would jump straight to that point's
 * value instead of continuing the curve, an audible change a split must not
 * make (Pro Tools inserts a breakpoint at the split for the same reason).
 *
 * The value comes from the runtime's own evaluator on the live source lane,
 * so linked-lane resolution, curve shapes, and lane-range clamping are
 * exactly what played a moment earlier — including the drawn-then-held shape,
 * whose ramps end mid-clip: the held value IS the curve at the cut, and the
 * seam pins it onto the fragment. A point already sitting on the cut IS that
 * seam — a second point beside it would make the interpolation span
 * zero-width. No point left of the cut means the runtime held the first value
 * before its point anyway, which the verbatim copy reproduces for free.
 *
 * The seam inherits the straddling segment's `curve`/`tension`/`stairSteps`
 * from its left point — segment shape is owned by the segment's left point
 * (`evaluateAutomationCurve` branches on it), so a copied `linear`/`step`
 * seam reproduces the played segment exactly and a shaped one stays in the
 * curve family it was drawn with instead of flattening to a straight ramp.
 * A straddling `bezier` segment additionally carries the de Casteljau right
 * half as `cp1`/`cp2` (`bezierSeamControlPoints`) — the family alone would
 * play the default quad. The id derives from the right clip id, so a redo
 * re-split reproduces exactly the point the original split's undo retired.
 */
function seamPointFor(
    lane: AutomationLaneValue,
    rightClipId: string,
    laneIndex: number,
    absoluteSplitBeats: number
): AutomationLanePoint | null {
    if (lane.points.some((point) => point.beat === absoluteSplitBeats)) {
        return null;
    }
    const lastLeft = [...lane.points].reverse().find((point) => point.beat < absoluteSplitBeats);
    if (lastLeft === undefined) {
        return null;
    }
    const seamValue = getAutomationValueAtBeat(lane.id, absoluteSplitBeats);
    if (seamValue === null) {
        return null;
    }
    // Points are kept sorted by beat, and the on-the-cut guard above already
    // returned, so this is the evaluator's segment right endpoint
    // (`points[beforeIdx + 1]` for a query at the cut).
    const nextPoint = lane.points.find((point) => point.beat > absoluteSplitBeats);
    const { cp1, cp2 } = bezierSeamControlPoints(lastLeft, nextPoint, absoluteSplitBeats);
    return {
        id: `asp-split-${rightClipId}-${laneIndex}`,
        beat: absoluteSplitBeats,
        value: seamValue,
        curve: lastLeft.curve,
        tension: lastLeft.tension,
        ...(lastLeft.stairSteps === undefined ? {} : { stairSteps: lastLeft.stairSteps }),
        ...(cp1 === undefined ? {} : { cp1 }),
        ...(cp2 === undefined ? {} : { cp2 }),
    };
}

/**
 * The right fragment's share of the source's clip-scoped automation lanes —
 * the split-automation convention (Logic splits region automation with the
 * region; REAPER take envelopes travel with each split item, and Pro Tools
 * clip automation belongs to the clip, so both halves keep playing what they
 * played before the cut).
 *
 * Lane points live in the ABSOLUTE timeline frame, so the copy keeps them
 * verbatim and is only clamped to the fragment's window — points left of the
 * cut stay on the source lane (inert beyond its shrunken edge, and alive
 * again if that edge is extended back out), points at or right of the cut
 * follow the right fragment. Re-basing them would move the curve off the
 * audio it was drawn against. A straddling segment gets a seam point at the
 * cut (`seamPointFor`) so the fragment continues the curve instead of
 * holding the first copied value — and a lane whose ramps END left of the
 * cut (drawn-then-held, the common shape) travels too: the runtime holds the
 * last point's value for every beat after it, so the lane is still driving
 * its parameter over the right span, and the seam carries that held value.
 *
 * The LEFT half needs no seam at all: it keeps its clip id, lane id, and whole
 * point set untouched, so a straddling segment A→B still evaluates its beats
 * left of the cut at fractions below the cut fraction — the identical
 * pre-split evaluation, not a look-alike (`splitClipBezierExactness.spec.ts`
 * pins both halves' exactness).
 *
 * Linked (follower) lanes travel by their RESOLVED source, not their own
 * points: a follower's played curve is its link target's (`resolveLinkedLane`
 * — its own points are ignored), so a follower whose own arrays are empty or
 * all left of the cut would otherwise be skipped and the driven parameter
 * would fall back to base over the right span. A follower whose resolved
 * source has a curve at the cut copies too, keeping `linkedLaneId` and
 * `linkScale` as clip duplication does; when the direct leader is itself
 * copied onto the fragment, the follower copy follows the leader's copy, so
 * the chain stays inside the fragment and survives undo/redo on the same
 * deterministic ids. A follower whose chain end has no curve there copies as
 * nothing, exactly as before.
 *
 * Automation objects are bounded containers whose ids must stay unique, and
 * the source lane outlives the split — so objects stay with the left half
 * whole rather than being duplicated onto the copy. An object reaching into
 * the right fragment keeps playing there through the source lane only if a
 * later edit re-extends the left edge; the point curves, which carry the
 * common cases, do travel.
 *
 * A lane with no played curve at the cut at all — no points of its own, and
 * a follower whose chain end has none — copies as nothing: the source lane
 * already keeps that parameter alive over the left half.
 * Copy ids derive from the right clip id, so a redo re-split reproduces
 * exactly the lanes the original split's undo retired.
 */
function splitAutomationLanes(
    sourceClipId: string,
    rightClipId: string,
    absoluteSplitBeats: number
): AutomationLaneValue[] {
    const atOrAfterCut = (point: { beat: number }): boolean => point.beat >= absoluteSplitBeats;
    const laneById = new Map(getAutomationLanes().map((lane) => [lane.id, lane]));
    const copyIdBySourceLaneId = new Map<string, string>();
    const copies: AutomationLaneValue[] = [];
    for (const [index, lane] of readClipScopedAutomationLanes([sourceClipId]).entries()) {
        const resolvedLink =
            lane.linkedLaneId === undefined ? null : resolveLinkedLane(lane.id, (id) => laneById.get(id));
        const resolvedSource = resolvedLink === null ? undefined : laneById.get(resolvedLink.sourceLaneId);
        // The runtime holds a lane's last value for every beat after it, so
        // ANY point — including one strictly left of the cut — leaves the
        // curve defined at the cut. A follower plays its chain end's curve,
        // never its own points.
        const linkedSourceReachesRightSpan = resolvedSource !== undefined && resolvedSource.points.length > 0;
        const hasOwnPlayedCurve = lane.points.length > 0;
        const hasOwnOverlayRightContent =
            (lane.trimPoints?.some(atOrAfterCut) ?? false) || (lane.ghostPoints?.some(atOrAfterCut) ?? false);
        if (!hasOwnPlayedCurve && !hasOwnOverlayRightContent && !linkedSourceReachesRightSpan) {
            continue;
        }
        const copy = buildLaneCopy(lane, index, rightClipId, absoluteSplitBeats, resolvedLink === null);
        copyIdBySourceLaneId.set(lane.id, copy.id);
        copies.push(copy);
    }
    // A follower whose direct leader also copied follows the leader's copy, so
    // the fragment's chain is self-contained; a leader that stayed behind (its
    // own points never reach the right span, or it lives outside this clip)
    // survives the split untouched and the link keeps resolving to it.
    for (const copy of copies) {
        if (copy.linkedLaneId === undefined) {
            continue;
        }
        const leaderCopyId = copyIdBySourceLaneId.get(copy.linkedLaneId);
        if (leaderCopyId !== undefined) {
            copy.linkedLaneId = leaderCopyId;
        }
    }
    return copies;
}

/**
 * The copy of one source lane, clamped to the fragment's window. `includeSeam`
 * marks a self-standing lane — a follower plays its leader's curve (the seam
 * that copy carries) and its own points are never evaluated. A lane with any
 * main point gets the seam: for a straddling segment it continues the curve,
 * and for a drawn-then-held shape it pins the held value at the fragment's
 * first beat.
 */
function buildLaneCopy(
    lane: AutomationLaneValue,
    laneIndex: number,
    rightClipId: string,
    absoluteSplitBeats: number,
    includeSeam: boolean
): AutomationLaneValue {
    const atOrAfterCut = (point: { beat: number }): boolean => point.beat >= absoluteSplitBeats;
    const points = lane.points.filter(atOrAfterCut).map((point) => ({ ...point }));
    const trimPoints = lane.trimPoints?.filter(atOrAfterCut).map((point) => ({ ...point }));
    const ghostPoints = lane.ghostPoints?.filter(atOrAfterCut).map((point) => ({ ...point }));
    if (includeSeam && lane.points.length > 0) {
        const seamPoint = seamPointFor(lane, rightClipId, laneIndex, absoluteSplitBeats);
        if (seamPoint !== null) {
            points.unshift(seamPoint);
        }
    }
    const copy: AutomationLaneValue = {
        ...lane,
        id: `auto-split-${rightClipId}-${laneIndex}`,
        clipId: rightClipId,
        points,
        objects: [],
    };
    if (trimPoints !== undefined) {
        copy.trimPoints = trimPoints;
    }
    if (ghostPoints !== undefined) {
        copy.ghostPoints = ghostPoints;
    }
    return copy;
}

/**
 * Repartition the source clip's gain envelope and warp state across the two
 * halves of a split.
 *
 * Always emits both entries on both legs, including for a source clip carrying
 * no satellites at all: the undo leg's explicit null entry for the right clip id
 * is the only thing that retires whatever that clip picked up while it existed,
 * because `replaceClipSplitTrackState` merely drops its rectangle from the track
 * array. Without it a curve drawn on the right half would outlive the clip,
 * keyed to a dead id and written to every save.
 *
 * Seam point ids derive from the right clip id, so a redo re-split reproduces
 * exactly the entries the original split's undo captured.
 */
export function prepareClipSplitSatellites(input: PrepareClipSplitSatellitesInput): ClipSplitSatellitePlan {
    const { clipId, rightClipId, contentSplitBeats, absoluteSplitBeats } = input;
    const source = readClipSatelliteEntry(clipId);
    const gainEnvelopes =
        source.gainEnvelope !== null && source.gainEnvelope.points.length > 0
            ? splitGainEnvelope(source.gainEnvelope, input)
            : NO_GAIN_ENVELOPES;
    const warpStates = source.warpState !== null ? splitWarpState(source.warpState, contentSplitBeats) : NO_WARP_STATES;

    return {
        previous: [source, { clipId: rightClipId, gainEnvelope: null, warpState: null }],
        next: [
            { clipId, gainEnvelope: gainEnvelopes.left, warpState: warpStates.left },
            { clipId: rightClipId, gainEnvelope: gainEnvelopes.right, warpState: warpStates.right },
        ],
        rightAutomationLanes: splitAutomationLanes(clipId, rightClipId, absoluteSplitBeats),
    };
}
