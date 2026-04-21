import { automationStore } from '#/modules/Automation/stores';
import { shiftMidiNotesAfterBeat } from '#/modules/MIDI/useCases';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore } from '../../stores/markerStore';

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
            markers: markerState.markers.map((message) => (message.beat >= atBeat ? { ...message, beat: message.beat + durationBeats } : message)),
        });
    }

    const autoState = automationStore.value;
    if (autoState) {
        automationStore.set({
            ...autoState,
            lanes: autoState.lanes.map((lane) => ({
                ...lane,
                points: lane.points.map((param) => (param.beat >= atBeat ? { ...param, beat: param.beat + durationBeats } : param)),
            })),
        });
    }

    // Tempo changes at or after the insertion point must shift forward.
    const tempoState = tempoMapStore.value;
    if (tempoState) {
        tempoMapStore.set({
            ...tempoState,
            changes: tempoState.changes.map((context) => (context.beat >= atBeat ? { ...context, beat: context.beat + durationBeats } : context)),
        });
    }

    // Time signature changes at or after the insertion point must shift forward.
    const timeSigState = timeSignatureMapStore.value;
    if (timeSigState) {
        timeSignatureMapStore.set({
            ...timeSigState,
            changes: timeSigState.changes.map((context) => (context.beat >= atBeat ? { ...context, beat: context.beat + durationBeats } : context)),
        });
    }

    // MIDI notes and CC/pitch-bend events live in absolute beat coordinates,
    // so they must follow the same global time shift. Without this the clip
    // rectangles move to the right but the notes inside stay put.
    shiftMidiNotesAfterBeat({ atBeat, delta: durationBeats });
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
                (context) => context.startBeat >= startBeat && context.endBeat <= endBeat + duration && context.startBeat < endBeat
            );
            const duplicated = clipsInRange.map((context) => ({
                ...context,
                id: `clip-dup-${crypto.randomUUID()}`,
                startBeat: context.startBeat + duration,
                endBeat: context.endBeat + duration,
            }));
            return { ...track, clips: [...track.clips, ...duplicated] };
        }),
    });
}
