import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';

export function applyGroove(clipId: string, template: GrooveTemplate, amount = 1.0): void {
    function findClip(id: string) {
        const tracks = getAllTracks();
        for (const track of tracks) {
            const clip = track.clips.find((context) => context.id === id);
            if (clip) {
                return clip;
            }
        }
        return undefined;
    }

    // Read and write MIDI notes through the MIDI module's owning use-cases
    // rather than mutating `midiStore` directly — the note store's write path
    // belongs to MIDI (`setNotesForClip`), not to AiGeneration.
    const existing = getNotesForClip(clipId);
    if (existing.length === 0) {
        return;
    }

    const clip = findClip(clipId);
    const clipLength = clip ? clip.endBeat - clip.startBeat : 4;
    const stepSize = clipLength / template.subdivisions;
    const clampedAmount = Math.max(0, Math.min(1, amount));

    const updated = existing.map((note) => {
        const nearestStep = Math.round(note.startBeat / stepSize);
        const stepIndex = ((nearestStep % template.subdivisions) + template.subdivisions) % template.subdivisions;

        const offset = (template.offsets[stepIndex] ?? 0) * clampedAmount;
        const velScale = 1 + ((template.velocities[stepIndex] ?? 1) - 1) * clampedAmount;

        return {
            ...note,
            startBeat: Math.max(0, note.startBeat + offset),
            velocity: Math.max(1, Math.min(127, Math.round(note.velocity * velScale))),
        };
    });

    setNotesForClip(clipId, updated);
}
