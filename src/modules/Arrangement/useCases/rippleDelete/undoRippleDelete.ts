import { getAutomationLanes, restoreAutomationLanes, shiftClipAutomation } from '#/modules/Automation/useCases';

import { type ClipSatelliteEntry, writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type Clip } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackState } from '../setTrackState';

type AutomationLaneValue = ReturnType<typeof getAutomationLanes>[number];

type RippleDeleteShift = {
    clipId: string;
    origStartBeat: number;
    origEndBeat: number;
    automationDelta: number;
};

type UndoRippleDeleteInput = {
    trackId: string;
    removedClips: Clip[];
    shiftedClips: RippleDeleteShift[];
    /** Gain envelopes/warp states the removed clips carried, restored verbatim. */
    clipSatellites?: readonly ClipSatelliteEntry[];
    /** Clip-scoped automation lanes the removed clips carried, restored verbatim. */
    clipAutomationLanes?: readonly AutomationLaneValue[];
};

export function undoRippleDelete({
    trackId,
    removedClips,
    shiftedClips,
    clipSatellites,
    clipAutomationLanes,
}: UndoRippleDeleteInput): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const shiftMap = new Map(shiftedClips.map((shift) => [shift.clipId, shift]));

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }

            const restoredClips = track.clips.map((clip) => {
                const originalShift = shiftMap.get(clip.id);
                if (!originalShift) {
                    return clip;
                }

                return {
                    ...clip,
                    startBeat: originalShift.origStartBeat,
                    endBeat: originalShift.origEndBeat,
                };
            });

            return {
                ...track,
                clips: [...restoredClips, ...removedClips],
            };
        }),
    });

    for (const shifted of shiftedClips) {
        if (shifted.automationDelta !== 0) {
            shiftClipAutomation(shifted.clipId, -shifted.automationDelta);
        }
    }

    // The removed clips' gain envelopes, warp states, and clip-scoped
    // automation lanes were retired on the forward operation — bring them
    // back for the restored clips (ledger #2108).
    if (clipSatellites) {
        for (const entry of clipSatellites) {
            writeClipSatelliteEntry(entry);
        }
    }
    if (clipAutomationLanes && clipAutomationLanes.length > 0) {
        restoreAutomationLanes(clipAutomationLanes);
    }
}
