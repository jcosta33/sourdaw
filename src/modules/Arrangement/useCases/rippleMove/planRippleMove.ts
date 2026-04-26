import { workspaceStore } from '#/modules/Workspace/stores';

import { getTrackStoreState } from '../getTrackStoreState';

type ClipShift = {
    clipId: string;
    origStartBeat: number;
    origEndBeat: number;
};

export type RippleMovePlan = {
    /** Clips shifted backward to fill the gap left by the moved clip. */
    gapClosedClips: ClipShift[];
    /** Clips shifted forward to make room at the destination. */
    destinationOpenedClips: ClipShift[];
};

type PlanRippleMoveInput = {
    trackId: string;
    clipId: string;
    oldStartBeat: number;
    newStartBeat: number;
    clipDuration: number;
};

/**
 * Computes which clips need to shift when a clip is moved in ripple mode (R-B3.2).
 *
 * - Gap close: clips whose startBeat >= oldEndBeat shift backward by clipDuration.
 * - Destination open: clips whose startBeat >= newStartBeat shift forward by clipDuration.
 *
 * Returns null when ripple editing is disabled or track is not found.
 */
export function planRippleMove({
    trackId,
    clipId,
    oldStartBeat,
    newStartBeat,
    clipDuration,
}: PlanRippleMoveInput): RippleMovePlan | null {
    const rippleEnabled = workspaceStore.value?.rippleEditing ?? false;
    if (!rippleEnabled) {
        return null;
    }

    const state = getTrackStoreState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track) {
        return null;
    }

    const oldEndBeat = oldStartBeat + clipDuration;

    const gapClosedClips: ClipShift[] = [];
    const destinationOpenedClips: ClipShift[] = [];

    const destOpenedIds = new Set<string>();

    // First pass: identify clips that need to shift forward at the destination
    for (const clip of track.clips) {
        if (clip.id === clipId) {
            continue;
        }
        if (clip.startBeat >= newStartBeat) {
            destinationOpenedClips.push({
                clipId: clip.id,
                origStartBeat: clip.startBeat,
                origEndBeat: clip.endBeat,
            });
            destOpenedIds.add(clip.id);
        }
    }

    // Second pass: identify clips that shift backward to close the gap,
    // excluding any already in the destination-open set to avoid double-counting
    for (const clip of track.clips) {
        if (clip.id === clipId) {
            continue;
        }
        if (clip.startBeat >= oldEndBeat && !destOpenedIds.has(clip.id)) {
            gapClosedClips.push({
                clipId: clip.id,
                origStartBeat: clip.startBeat,
                origEndBeat: clip.endBeat,
            });
        }
    }

    return { gapClosedClips, destinationOpenedClips };
}
