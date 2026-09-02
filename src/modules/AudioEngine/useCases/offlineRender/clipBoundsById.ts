/**
 * A clip-scoped automation lane's `clipId` names an id in the track's own
 * `clips` — never `resolveTrackClipsWithComping`'s resolved playback set.
 * That resolution spreads the source clip at every fragment it emits (a comp
 * region, each gap fill around it), so ids are preserved, not renumbered —
 * the hazard is the opposite one: the same clip id can recur across several
 * narrowed fragments of one clip. A map keyed by that id is last-write-wins,
 * so building it from the resolved set would collapse those fragments onto
 * whichever one resolved last and lose the rest of the lane's window.
 * `scheduleTrackAutomation`'s clip-window law and the live producer's
 * exclusion mirror (`projectLiveAutomationWrites.ts`) both key off the same
 * clip ids the lane was authored against, so both build this map from the
 * track's raw `clips`, never the comped set.
 */

import { type Track } from '#/modules/Arrangement/stores';

export function clipBoundsById(track: Pick<Track, 'clips'>): Map<string, { startBeat: number; endBeat: number }> {
    const bounds = new Map<string, { startBeat: number; endBeat: number }>();
    for (const clip of track.clips) {
        bounds.set(clip.id, { startBeat: clip.startBeat, endBeat: clip.endBeat });
    }
    return bounds;
}
