import { getAllTracks } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { type GrooveTemplate } from '#/modules/AiGeneration/models/GrooveTemplate';

export function applyGroove(clipId: string, template: GrooveTemplate, amount = 1.0): void {
    function findClip(id: string) {
        const tracks = getAllTracks();
        for (const track of tracks) {
            const clip = track.clips.find((c) => c.id === id);
            if (clip) {
                return clip;
            }
        }
        return undefined;
    }

    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) {
        return;
    }

    const clip = findClip(clipId);
    const clipLength = clip ? clip.endBeat - clip.startBeat : 4;
    const stepSize = clipLength / template.subdivisions;
    const clampedAmount = Math.max(0, Math.min(1, amount));

    const updated = existing.map((note) => {
        const nearestStep = Math.round(note.startBeat / stepSize);
        const stepIndex =
            ((nearestStep % template.subdivisions) + template.subdivisions) % template.subdivisions;

        const offset = (template.offsets[stepIndex] ?? 0) * clampedAmount;
        const velScale = 1 + ((template.velocities[stepIndex] ?? 1) - 1) * clampedAmount;

        return {
            ...note,
            startBeat: Math.max(0, note.startBeat + offset),
            velocity: Math.max(1, Math.min(127, Math.round(note.velocity * velScale))),
        };
    });

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: updated,
        },
    });
}