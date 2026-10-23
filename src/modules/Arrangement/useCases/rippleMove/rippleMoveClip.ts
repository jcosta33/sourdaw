import { shiftClipAutomation } from '#/modules/Automation/useCases';
import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

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
 *
 * Returns whether the move landed. A refused move stops the whole plan — the
 * caller records nothing — because the neighbor shifts only make sense around
 * a move that actually happened.
 */
export function rippleMoveClip({ trackId, clipId, newStartBeat, clipDuration, plan }: RippleMoveClipInput): boolean {
    // Move the clip itself (also shifts automation and MIDI notes). A refused
    // move (a locked clip, an ineligible host, a clip gone since planning)
    // must leave every neighbor where it is: shifting them around a move that
    // never landed would strand the clip at its source, open a hole where it
    // should have landed, and record an inverse for shifts over nothing.
    if (!moveClip(clipId, trackId, newStartBeat)) {
        return false;
    }

    const state = getTrackStoreState();
    if (!state) {
        return false;
    }

    // Build shift deltas for other clips
    const gapCloseSet = new Set(plan.gapClosedClips.map((context) => context.clipId));
    const destOpenSet = new Set(plan.destinationOpenedClips.map((context) => context.clipId));

    // gap close = -duration, destination open = +duration
    // A clip in both sets gets net zero shift (adjacent positions)
    const collateralDeltas = new Map<string, number>();
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
                    collateralDeltas.set(clip.id, delta);
                    return {
                        ...clip,
                        startBeat: clip.startBeat + delta,
                        endBeat: clip.endBeat + delta,
                        // A collateral shift relocates the clip without touching
                        // its content offset; the loop anchor moves with it so
                        // the shift cannot re-roll which passes sound (#4988).
                        ...shiftLoopOriginEntry(clip, delta),
                    };
                }),
            };
        }),
    });

    // Timeline-absolute clip-scoped automation follows each collateral shift
    // (ledger M-025); clip-relative MIDI notes follow on their own.
    for (const [collateralClipId, delta] of collateralDeltas) {
        shiftClipAutomation(collateralClipId, delta);
    }

    return true;
}
