import { moveClip } from '../clip/moveClip';
import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackState } from '../setTrackState';

import { type RippleMovePlan } from './planRippleMove';

type RippleMoveClipInput = {
    trackId: string;
    clipId: string;
    newStartBeat: number;
    clipDuration: number;
    plan: RippleMovePlan;
};

/**
 * Executes a ripple move (R-B3.2):
 * 1. Moves the clip to its new position (via moveClip — handles automation and MIDI shifting).
 * 2. Shifts clips at the source backward to fill the gap.
 * 3. Shifts clips at the destination forward to make room.
 */
export function rippleMoveClip({ trackId, clipId, newStartBeat, clipDuration, plan }: RippleMoveClipInput): void {
    // Move the clip itself (also shifts automation and MIDI notes)
    moveClip(clipId, trackId, newStartBeat);

    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    // Build shift deltas for other clips
    const gapCloseSet = new Set(plan.gapClosedClips.map((c) => c.clipId));
    const destOpenSet = new Set(plan.destinationOpenedClips.map((c) => c.clipId));

    // gap close = -duration, destination open = +duration
    // A clip in both sets gets net zero shift (adjacent positions)
    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }
            return {
                ...track,
                clips: track.clips.map((clip) => {
                    if (clip.id === clipId) {
                        return clip; // already moved above
                    }
                    const closesGap = gapCloseSet.has(clip.id);
                    const opensDestination = destOpenSet.has(clip.id);
                    let delta = 0;
                    if (closesGap) {
                        delta -= clipDuration;
                    }
                    if (opensDestination) {
                        delta += clipDuration;
                    }
                    if (delta === 0) {
                        return clip;
                    }
                    return {
                        ...clip,
                        startBeat: clip.startBeat + delta,
                        endBeat: clip.endBeat + delta,
                    };
                }),
            };
        }),
    });
}
