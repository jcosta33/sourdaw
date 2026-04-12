import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore } from '../../stores/markerStore';
import { automationStore } from '#/modules/Automation';
import { type Clip } from '../../models/Track';

export function deleteTime(startBeat: number, endBeat: number): void {
    const state = getTrackState();
    if (!state) {
        return;
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
                .filter((m) => m.beat < startBeat || m.beat >= endBeat)
                .map((m) => (m.beat >= endBeat ? { ...m, beat: m.beat - duration } : m)),
        });
    }

    const autoState = automationStore.value;
    if (autoState) {
        automationStore.set({
            ...autoState,
            lanes: autoState.lanes.map((lane) => ({
                ...lane,
                points: lane.points
                    .filter((p) => p.beat < startBeat || p.beat >= endBeat)
                    .map((p) => (p.beat >= endBeat ? { ...p, beat: p.beat - duration } : p)),
            })),
        });
    }
}