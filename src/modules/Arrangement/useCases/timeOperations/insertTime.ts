import { shiftAutomationAfterBeat } from '#/modules/Automation/useCases';
import { shiftMidiNotesAfterBeat } from '#/modules/MIDI/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore } from '../../stores/markerStore';

import { timeOperationDependencies } from './timeOperationDependencies';

export function insertTime(atBeat: number, durationBeats: number): void {
    const deps = timeOperationDependencies;
    if (!deps) {
        throw new Error('Arrangement time operation dependencies are not registered');
    }

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
            markers: markerState.markers.map((message) =>
                message.beat >= atBeat ? { ...message, beat: message.beat + durationBeats } : message
            ),
        });
    }

    shiftAutomationAfterBeat({ atBeat, deltaBeats: durationBeats });
    deps.shiftTimelineMapsAfterBeat({ atBeat, deltaBeats: durationBeats });
    shiftMidiNotesAfterBeat({ atBeat, delta: durationBeats });
}
