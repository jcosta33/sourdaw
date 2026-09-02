/**
 * A clip-scoped automation lane's `clipId` names an id in the track's own
 * `clips` — never `resolveTrackClipsWithComping`'s resolved playback set,
 * which drops, splits, and renumbers takes for what the track actually
 * plays. `scheduleTrackAutomation`'s clip-window law and the live producer's
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
