import { type ClipSatelliteEntry, readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type GainEnvelopePoint } from '../../stores/gainEnvelopeStore';
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

/**
 * Repartition the source clip's gain envelope and warp state across the two
 * halves of a split. Returns `null` when the source clip carries neither, so a
 * bare split produces no satellite entries at all.
 *
 * The two records live on different axes. Warp markers are keyed to *source
 * content* beats (the elastic editor draws them over the whole buffer), and the
 * right clip's `audioOffsetBeats` grew by the split, so markers keep their
 * coordinates on both sides — the partition is by content beat alone. Gain
 * envelope points are clip-relative, so points moving right are re-based by the
 * split delta, and each half gets a synthetic seam point holding the curve's
 * interpolated value at the cut: the split must not change what the envelope
 * sounded like. A source point sitting exactly at the cut becomes the right
 * half's point at 0 and no second seam point duplicates it (two points at one
 * beat would make the interpolation span zero-width).
 *
 * Seam point ids derive from the right clip id, so a redo re-split reproduces
 * exactly the entries the original split's undo captured.
 */
export function prepareClipSplitSatellites({
    clipId,
    rightClipId,
    clipRelativeSplitBeats,
    contentSplitBeats,
}: PrepareClipSplitSatellitesInput): ClipSplitSatellitePlan | null {
    const source = readClipSatelliteEntry(clipId);
    if (source.gainEnvelope === null && source.warpState === null) {
        return null;
    }

    let leftGainEnvelope: ClipSatelliteEntry['gainEnvelope'] = null;
    let rightGainEnvelope: ClipSatelliteEntry['gainEnvelope'] = null;
    if (source.gainEnvelope !== null && source.gainEnvelope.points.length > 0) {
        const seamGainDb = sampleGainEnvelopePoints(source.gainEnvelope.points, clipRelativeSplitBeats);
        const leftPoints: GainEnvelopePoint[] = source.gainEnvelope.points
            .filter((point) => point.beatOffset < clipRelativeSplitBeats)
            .map((point) => ({ ...point }));
        leftPoints.push({
            id: `gep-split-${rightClipId}-left`,
            beatOffset: clipRelativeSplitBeats,
            gainDb: seamGainDb,
        });
        const rightPoints: GainEnvelopePoint[] = [];
        const cutPoint = source.gainEnvelope.points.find((point) => point.beatOffset === clipRelativeSplitBeats);
        if (!cutPoint) {
            rightPoints.push({ id: `gep-split-${rightClipId}-right`, beatOffset: 0, gainDb: seamGainDb });
        }
        for (const point of source.gainEnvelope.points) {
            if (point.beatOffset >= clipRelativeSplitBeats) {
                rightPoints.push({ ...point, beatOffset: point.beatOffset - clipRelativeSplitBeats });
            }
        }
        leftGainEnvelope = { clipId, points: leftPoints, enabled: source.gainEnvelope.enabled };
        rightGainEnvelope = { clipId: rightClipId, points: rightPoints, enabled: source.gainEnvelope.enabled };
    }

    let leftWarpState: ClipSatelliteEntry['warpState'] = null;
    let rightWarpState: ClipSatelliteEntry['warpState'] = null;
    if (source.warpState !== null) {
        const leftState = {
            ...source.warpState,
            markers: source.warpState.markers.filter((marker) => marker.originalBeat < contentSplitBeats),
        };
        const rightState = {
            ...source.warpState,
            markers: source.warpState.markers.filter((marker) => marker.originalBeat >= contentSplitBeats),
        };
        // A half whose markers all left may collapse to the default state; that
        // is no satellite at all, not a record worth keeping (hasNonDefaultWarpState
        // precedent).
        leftWarpState = isDefaultWarpState(leftState) ? null : leftState;
        rightWarpState = isDefaultWarpState(rightState) ? null : rightState;
    }

    return {
        previous: [source, { clipId: rightClipId, gainEnvelope: null, warpState: null }],
        next: [
            { clipId, gainEnvelope: leftGainEnvelope, warpState: leftWarpState },
            { clipId: rightClipId, gainEnvelope: rightGainEnvelope, warpState: rightWarpState },
        ],
    };
}
