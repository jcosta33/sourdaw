import { type Track } from './Track';

/** Height of one variation lane (one per track alternative) under its track. */
export const VARIATION_LANE_HEIGHT = 24;

type LaneHostingTrack = Pick<Track, 'kind' | 'showVariationLanes' | 'alternatives'>;

/**
 * Whether a track has variation lanes switched on and can host them. Folder and
 * master rows never do. This says the toggle is on, not how many lane rows the
 * canvas draws: a track with no alternatives yet still shows its take panel.
 */
export function showsVariationLanes(track: Pick<Track, 'kind' | 'showVariationLanes'>): boolean {
    if (track.kind === 'folder' || track.kind === 'master') {
        return false;
    }
    return track.showVariationLanes === true;
}

/** How many lane rows sit under a track: one per alternative while its lanes are shown. */
export function getVariationLaneCount(track: LaneHostingTrack): number {
    return showsVariationLanes(track) ? track.alternatives.length : 0;
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
