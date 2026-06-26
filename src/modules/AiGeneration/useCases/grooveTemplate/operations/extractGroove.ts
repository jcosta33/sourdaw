import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';

/**
 * MIDI velocities run 0–127, so a recorded note at full velocity should map to
 * a groove factor of 1.0. Normalising against 127 (not 100) keeps the
 * extracted velocity factors in their intended ~[0, 1] band; `applyGroove`
 * treats 1.0 as "unchanged" and scales around it.
 */
const REFERENCE_VELOCITY = 127;

/** Local type matching Track module's MidiNote shape, avoids cross-module model import. */
type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

export function extractGroove(clipId: string, subdivisions = 16): GrooveTemplate {
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

    // Read MIDI notes through the MIDI module's owning use-case rather than
    // reaching into `midiStore` directly — the note store belongs to MIDI.
    const notes: MidiNote[] = getNotesForClip(clipId);

    const clip = findClip(clipId);
    const clipLength = clip ? clip.endBeat - clip.startBeat : 4;
    const stepSize = clipLength / subdivisions;

    const offsetAccum: number[][] = Array.from({ length: subdivisions }, () => []);
    const velocityAccum: number[][] = Array.from({ length: subdivisions }, () => []);

    for (const note of notes) {
        const nearestStep = Math.round(note.startBeat / stepSize);
        const stepIndex = ((nearestStep % subdivisions) + subdivisions) % subdivisions;
        const gridBeat = stepIndex * stepSize;
        const offset = note.startBeat - gridBeat;

        offsetAccum[stepIndex]!.push(Math.max(-0.5, Math.min(0.5, offset)));
        velocityAccum[stepIndex]!.push(note.velocity / REFERENCE_VELOCITY);
    }

    const offsets = offsetAccum.map((arr) =>
        arr.length > 0 ? arr.reduce((alpha, b) => alpha + b, 0) / arr.length : 0
    );
    const velocities = velocityAccum.map((arr) =>
        arr.length > 0 ? arr.reduce((alpha, b) => alpha + b, 0) / arr.length : 1
    );

    return {
        id: `extracted-${clipId}`,
        name: `Extracted from ${clipId}`,
        subdivisions,
        offsets,
        velocities,
    };
}
