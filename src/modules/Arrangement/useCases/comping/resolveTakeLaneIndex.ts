import { type TakeLane } from '../../models/TakeLane';

/**
 * The index of the lane a replay is about: the captured lane itself, or the lane its
 * track now owns.
 *
 * A track owns one lane — the store's readers take the first one for a track, so a
 * second lane's takes and regions are dead state — and a projection can give the track
 * a lane of its own while the capture is away. Every route that creates a lane keeps
 * that rule, with `handleRestoreTrack` the exception: it appends its captured lanes
 * straight to the store and can still leave two for a track (#4527), which is that
 * route's own defect rather than something this resolution can repair. Undo and redo
 * replay against the live store, so both directions resolve the lane the same way
 * rather than assume the identity they captured still stands: the undo merges into the
 * lane this finds, and the paired redo retires the insertion from that same lane, which
 * the captured id alone no longer names.
 */
export function resolveTakeLaneIndex(lanes: readonly TakeLane[], lane: TakeLane): number {
    return lanes.findIndex((existing) => existing.id === lane.id || existing.trackId === lane.trackId);
}
