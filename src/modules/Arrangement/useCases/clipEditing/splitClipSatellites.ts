import { type WarpState } from '../../models/WarpMarker';
import { type ClipSatelliteEntry, readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type ClipGainEnvelope, type GainEnvelopePoint } from '../../stores/gainEnvelopeStore';
import { isDefaultWarpState } from '../../stores/warpStates';
import { sampleGainEnvelopePoints } from '../clipGainEnvelope/sampleGainEnvelopePoints';

/**
 * The satellite half of a split plan: `previous` is what the stores hold before
 * the split (plus an explicit null entry for the right clip id, so an undo
 * clears the right half's satellites), `next` is what they hold after.
 */
export type ClipSplitSatellitePlan = {
    previous: ClipSatelliteEntry[];
    next: ClipSatelliteEntry[];
};

type PrepareClipSplitSatellitesInput = {
    clipId: string;
    rightClipId: string;
    /** Cut position relative to the clip start — the gain envelope axis. */
    clipRelativeSplitBeats: number;
    /** Cut position in source content beats — the warp marker axis. */
    contentSplitBeats: number;
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
    const { clipId, rightClipId, contentSplitBeats } = input;
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
    };
}
