import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore } from '../../stores/markerStore';
import { automationStore } from '#/modules/Automation';

export function insertTime(atBeat: number, durationBeats: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => {
                if (clip.endBeat <= atBeat) {
                    return clip;
                }
                if (clip.startBeat >= atBeat) {
                    return {
                        ...clip,
                        startBeat: clip.startBeat + durationBeats,
                        endBeat: clip.endBeat + durationBeats,
                    };
                }
                return { ...clip, endBeat: clip.endBeat + durationBeats };
            }),
        })),
    });

    const markerState = markerStore.value;
    if (markerState) {
        markerStore.set({
            ...markerState,
            markers: markerState.markers.map((m) =>
                m.beat >= atBeat ? { ...m, beat: m.beat + durationBeats } : m
            ),
        });
    }

    const autoState = automationStore.value;
    if (autoState) {
        automationStore.set({
            ...autoState,
            lanes: autoState.lanes.map((lane) => ({
                ...lane,
                points: lane.points.map((p) =>
                    p.beat >= atBeat ? { ...p, beat: p.beat + durationBeats } : p
                ),
            })),
        });
    }
}

export function duplicateTimeRange(startBeat: number, endBeat: number): void {
    const duration = endBeat - startBeat;
    insertTime(endBeat, duration);

    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            const clipsInRange = track.clips.filter(
                (c) =>
                    c.startBeat >= startBeat &&
                    c.endBeat <= endBeat + duration &&
                    c.startBeat < endBeat
            );
            const duplicated = clipsInRange.map((c) => ({
                ...c,
                id: `clip-dup-${crypto.randomUUID()}`,
                startBeat: c.startBeat + duration,
                endBeat: c.endBeat + duration,
            }));
            return { ...track, clips: [...track.clips, ...duplicated] };
        }),
    });
}