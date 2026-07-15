import { deleteAutomationTimeRange } from '#/modules/Automation/useCases';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore } from '../../stores/markerStore';

import { timeOperationDependencies } from './timeOperationDependencies';

export function deleteTime(startBeat: number, endBeat: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const deps = timeOperationDependencies;
    if (!deps) {
        throw new Error('Arrangement time operation dependencies are not registered');
    }

    const duration = endBeat - startBeat;

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            const newClips: Clip[] = [];
            for (const clip of track.clips) {
                if (clip.endBeat <= startBeat) {
                    newClips.push(clip);
                } else if (clip.startBeat >= endBeat) {
                    newClips.push({
                        ...clip,
                        startBeat: clip.startBeat - duration,
                        endBeat: clip.endBeat - duration,
                    });
                } else if (clip.startBeat >= startBeat && clip.endBeat <= endBeat) {
                    // Fully inside deleted region — remove
                } else if (clip.startBeat < startBeat && clip.endBeat > endBeat) {
                    newClips.push({ ...clip, endBeat: clip.endBeat - duration });
                } else if (clip.startBeat < startBeat) {
                    newClips.push({ ...clip, endBeat: startBeat });
                } else {
                    newClips.push({ ...clip, startBeat, endBeat: clip.endBeat - duration });
                }
            }
            return { ...track, clips: newClips };
        }),
    });

    const markerState = markerStore.value;
    if (markerState) {
        markerStore.set({
            ...markerState,
            markers: markerState.markers
                .filter((message) => message.beat < startBeat || message.beat >= endBeat)
                .map((message) => (message.beat >= endBeat ? { ...message, beat: message.beat - duration } : message)),
        });
    }

    deleteAutomationTimeRange({ startBeat, endBeat });
    deps.deleteTimelineMapsTimeRange({ startBeat, endBeat });
}
