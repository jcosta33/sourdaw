import { type Track } from './Track';

/** Height of one variation lane (one per track alternative) under its track. */
export const VARIATION_LANE_HEIGHT = 24;

type LaneHostingTrack = Pick<Track, 'kind' | 'showVariationLanes' | 'alternatives'>;

/**
 * How many variation lanes sit under a track: one per alternative while the
 * track's toggle is on. Folder and master rows never host lanes.
 */
export function getVariationLaneCount(track: LaneHostingTrack): number {
    if (track.kind === 'folder' || track.kind === 'master') {
        return 0;
    }
    return track.showVariationLanes === true ? track.alternatives.length : 0;
}

/** Height of the block of variation lanes under a track's own row. */
export function getVariationLaneExtent(track: LaneHostingTrack): number {
    return getVariationLaneCount(track) * VARIATION_LANE_HEIGHT;
}

type RenderedTrack = { height: number; variationLanes?: readonly unknown[] };

/**
 * Vertical space a rendered track takes: its own row plus its variation lanes.
 * The canvas advances to the next row by exactly this, and every y-to-track
 * mapping steps by it.
 */
export function getRenderedTrackExtent(track: RenderedTrack): number {
    return track.height + (track.variationLanes?.length ?? 0) * VARIATION_LANE_HEIGHT;
}

/** Content-space top of each rendered track, in order. */
export function getRenderedTrackTops(tracks: readonly RenderedTrack[]): number[] {
    const tops: number[] = [];
    let top = 0;
    for (const track of tracks) {
        tops.push(top);
        top += getRenderedTrackExtent(track);
    }
    return tops;
}
