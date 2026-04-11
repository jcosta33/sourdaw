/**
 * Export the current Toaster step pattern as MIDI clips on the child pad tracks.
 */

import { inject } from '#/infra/di/inject';
import { toasterStore } from '../stores/toasterStore';
import { getAllTracks, addClip } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI';
import { playheadPositionRef } from '#/modules/Transport/stores';

export const exportPatternToTimelineDependencies = {
    getAllTracks,
    addMidiNote,
    addClip,
    playheadPositionRef,
} as const;

export const exportPatternToTimeline = inject(exportPatternToTimelineDependencies)(
    ({ getAllTracks, addMidiNote, addClip, playheadPositionRef }) =>
        function exportPatternToTimeline(): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }

    const tracks = getAllTracks();
    const parentTrack = tracks.find((t) => t.devices.some((d) => d.type === 'toaster'));
    if (!parentTrack) {
        return;
    }

    const childTracks = tracks.filter((t) => t.parentId === parentTrack.id);
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
        const hasActiveSteps = track.steps.slice(0, numSteps).some((s) => s.active);
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
        for (let s = 0; s < numSteps; s++) {
            const step = track.steps[s];
            if (!step?.active) {
                continue;
            }

            const startBeat = s * stepDurationBeats;
            const midiNote = 36 + track.padIndex;
            const velocity = Math.round(step.velocity * 127);

            addMidiNote(clipId, midiNote, startBeat, stepDurationBeats * 0.9, velocity);
        }
    }
}
);
