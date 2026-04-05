import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { setTrackState } from '#/modules/Arrangement/repositories/track/setTrackState';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { type Clip } from '#/modules/Arrangement/models/Track';

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
                    newClips.push({ ...clip, startBeat: clip.startBeat - duration, endBeat: clip.endBeat - duration });
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
            markers: markerState.markers.map((m) => (m.beat >= atBeat ? { ...m, beat: m.beat + durationBeats } : m)),
        });
    }

    const autoState = automationStore.value;
    if (autoState) {
        automationStore.set({
            ...autoState,
            lanes: autoState.lanes.map((lane) => ({
                ...lane,
                points: lane.points.map((p) => (p.beat >= atBeat ? { ...p, beat: p.beat + durationBeats } : p)),
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

    let nextId = Date.now();
    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            const clipsInRange = track.clips.filter(
                (c) => c.startBeat >= startBeat && c.endBeat <= endBeat + duration && c.startBeat < endBeat
            );
            const duplicated = clipsInRange.map((c) => ({
                ...c,
                id: `clip-dup-${nextId++}`,
                startBeat: c.startBeat + duration,
                endBeat: c.endBeat + duration,
            }));
            return { ...track, clips: [...track.clips, ...duplicated] };
        }),
    });
}
