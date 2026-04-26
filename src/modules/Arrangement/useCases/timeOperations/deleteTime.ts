import { automationStore } from '#/modules/Automation/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore } from '../../stores/markerStore';

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
                .filter((message) => message.beat < startBeat || message.beat >= endBeat)
                .map((message) => (message.beat >= endBeat ? { ...message, beat: message.beat - duration } : message)),
        });
    }

    const autoState = automationStore.value;
    if (autoState) {
        automationStore.set({
            ...autoState,
            lanes: autoState.lanes.map((lane) => ({
                ...lane,
                points: lane.points
                    .filter((param) => param.beat < startBeat || param.beat >= endBeat)
                    .map((param) => (param.beat >= endBeat ? { ...param, beat: param.beat - duration } : param)),
            })),
        });
    }

    // Tempo changes inside the deleted range are removed; those after shift back.
    const tempoState = tempoMapStore.value;
    if (tempoState) {
        tempoMapStore.set({
            ...tempoState,
            changes: tempoState.changes
                .filter((context) => context.beat < startBeat || context.beat >= endBeat)
                .map((context) => (context.beat >= endBeat ? { ...context, beat: context.beat - duration } : context)),
        });
    }

    // Time signature changes inside the deleted range are removed; those after shift back.
    const timeSigState = timeSignatureMapStore.value;
    if (timeSigState) {
        timeSignatureMapStore.set({
            ...timeSigState,
            changes: timeSigState.changes
                .filter((context) => context.beat < startBeat || context.beat >= endBeat)
                .map((context) => (context.beat >= endBeat ? { ...context, beat: context.beat - duration } : context)),
        });
    }
}
