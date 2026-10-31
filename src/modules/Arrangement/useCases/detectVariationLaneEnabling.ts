import { showsVariationLanes } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';

type VariationLaneEnabling = {
    /** Whether each track currently shows variation lanes; pass it back as `previous` next time. */
    shown: ReadonlyMap<string, boolean>;
    /** Tracks that were already present with lanes off and now have them on. */
    enabledTrackIds: string[];
};

/**
 * Finds the tracks whose variation lanes the user just switched on. A track
 * that appears with lanes already on (a project loading) is not a switch, and
 * neither is anything on the first observation (`previous` null), which only
 * seeds the comparison.
 */
export function detectVariationLaneEnabling(
    previous: ReadonlyMap<string, boolean> | null,
    tracks: readonly Track[]
): VariationLaneEnabling {
    const shown = new Map(tracks.map((track) => [track.id, showsVariationLanes(track)]));
    if (previous === null) {
        return { shown, enabledTrackIds: [] };
    }
    const enabledTrackIds = tracks
        .filter((track) => previous.get(track.id) === false && shown.get(track.id) === true)
        .map((track) => track.id);
    return { shown, enabledTrackIds };
}
