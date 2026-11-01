import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore, type Clip } from '../../stores/trackStore';

import { recordingPassTiming } from './recordingPassTiming';

/** Keep undated PCM as an ordinary muted clip; never claim a measured placement. */
export function prepareRecoveredRecording(clip: Clip, endBeat: number): Clip | null {
    const owned = recordingPassTiming.ownedTakes(clip.id);
    const lanes = takeLaneStore.value;
    const live = trackStore.value?.tracks
        .find((track) => track.id === clip.trackId)
        ?.clips.find((item) => item.id === clip.id);
    const original = lanes?.lanes.flatMap((lane) => lane.takes).find((take) => take.id === owned?.originalTakeId);
    if (!live || !owned || !original || original.clipId !== clip.id || !lanes) {
        return null;
    }
    const end = Math.max(1, endBeat);
    takeLaneStore.set({
        lanes: lanes.lanes.map((lane) => {
            const retiredSelection = lane.takes.some(
                (take) => take.id !== original.id && owned.ownedTakeIds.has(take.id) && take.selected
            );
            const peerSelection = lane.takes.some((take) => !owned.ownedTakeIds.has(take.id) && take.selected);
            return {
                ...lane,
                takes: lane.takes.flatMap((take) => {
                    if (!owned.ownedTakeIds.has(take.id)) {
                        return [take];
                    }
                    if (take.id !== original.id) {
                        return [];
                    }
                    return [
                        {
                            id: take.id,
                            clipId: clip.id,
                            name: take.name,
                            selected: take.selected || (retiredSelection && !peerSelection),
                            startBeat: 0,
                            endBeat: end,
                        },
                    ];
                }),
                activeCompRegions: lane.activeCompRegions.filter((region) => !owned.ownedTakeIds.has(region.takeId)),
            };
        }),
    });
    // The commit updater merges fields, so explicit clearing matters here.
    return {
        ...live,
        audioBufferId: clip.audioBufferId,
        name: 'Recovered recording — align before playback',
        startBeat: 0,
        endBeat: end,
        muted: true,
        audioOffsetBeats: 0,
        loopEnabled: false,
        loopLength: undefined,
        loopOriginBeat: undefined,
        stretchRatio: undefined,
        stretchMode: 'off',
    };
}
