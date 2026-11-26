import { getStoredWarpState } from '../../stores/warpStates';

import { commitClipWarpState } from './commitClipWarpState';

type CommitWarpMarkerBeatDragInput = {
    clipId: string;
    markerId: string;
    /** Where the gesture ended; the stored marker still holds where it started. */
    originalBeat: number;
    warpedBeat: number;
};

/**
 * Commits one marker drag as a single action and so a single undo step. The
 * drag preview is ephemeral view state; a cancelled drag never calls this.
 */
export async function commitWarpMarkerBeatDrag(input: CommitWarpMarkerBeatDragInput): Promise<void> {
    const current = getStoredWarpState(input.clipId);
    if (!current?.markers.some((marker) => marker.id === input.markerId)) {
        return;
    }
    await commitClipWarpState(input.clipId, {
        ...current,
        markers: current.markers.map((marker) =>
            marker.id === input.markerId
                ? { ...marker, originalBeat: input.originalBeat, warpedBeat: input.warpedBeat }
                : marker
        ),
    });
}
