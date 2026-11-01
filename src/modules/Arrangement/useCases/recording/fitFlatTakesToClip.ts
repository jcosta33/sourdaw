import { takeLaneStore } from '../../stores/takeLaneStore';

type CommittedClipExtent = { id: string; startBeat: number; endBeat: number };

/**
 * Give every flat take of a committed recording clip the clip's own extent.
 *
 * A take with no source offset plays the clip's media as the clip places it, so
 * the committed clip is the one source of truth for where it sits. The live
 * stop closed the take on the gesture beat, but an audio capture commits a clip
 * whose window is latency-compensated, and the take would otherwise draw wider
 * than its media and let a comp region claim a tail with no audio behind it.
 * Loop-pass takes carry their own placement and are left alone.
 *
 * Runs after `placeRecordingTakes` and before the commit dispatch, because the
 * clip's final end waits for the placed passes; like placement it writes no
 * history entry, so the take lands in the commit's single entry.
 */
export function fitFlatTakesToClip(clip: CommittedClipExtent): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => ({
            ...lane,
            takes: lane.takes.map((take) => {
                if (take.clipId !== clip.id || take.sourceOffsetBeats !== undefined) {
                    return take;
                }
                return { ...take, startBeat: clip.startBeat, endBeat: clip.endBeat };
            }),
        })),
    });
}
