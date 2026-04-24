import { getAllTracks, addClip } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { toasterStore } from '../stores/toasterStore';

export function exportPatternToTimeline(deviceId: string): void {
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return;
    }

    const pattern = state.kit.patterns.find((param) => param.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }

    const tracks = getAllTracks();
    const parentTrack = tracks.find((t) => t.devices.some((d) => d.id === deviceId));
    if (!parentTrack) {
        return;
    }

    const childTracks = tracks.filter((time) => time.parentId === parentTrack.id);
    const stepsPerBar = pattern.stepsPerBar;
    const totalSteps = stepsPerBar * pattern.bars;
    const stepDurationBeats = 4 / stepsPerBar;
    const insertAt = playheadPositionRef.current; // beats — place pattern at playhead

    for (const track of pattern.tracks) {
        const childTrack = childTracks[track.padIndex];
        if (!childTrack) {
            continue;
        }

        // Check for active steps on this pad
        const numSteps = track.stepsOverride ?? totalSteps;
        const hasActiveSteps = track.steps.slice(0, numSteps).some((state1) => state1.active);
        if (!hasActiveSteps) {
            continue;
        }

        // Create a new MIDI clip at the playhead position
        const clipLength = pattern.bars * 4;
        const clip = addClip({
            trackId: childTrack.id,
            startBeat: insertAt,
            endBeat: insertAt + clipLength,
            name: childTrack.name,
            type: 'midi',
        });
        if (!clip) {
            continue;
        }
        const clipId = clip.id;

        // Add MIDI notes for each active step
        for (let state1 = 0; state1 < numSteps; state1++) {
            const step = track.steps[state1];
            if (!step?.active) {
                continue;
            }

            const startBeat = state1 * stepDurationBeats;
            const midiNote = 36 + track.padIndex;
            const velocity = Math.round(step.velocity * 127);

            addMidiNote(clipId, midiNote, startBeat, stepDurationBeats * 0.9, velocity);
        }
    }
}
