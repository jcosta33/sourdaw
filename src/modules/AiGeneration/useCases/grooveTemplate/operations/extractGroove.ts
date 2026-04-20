import { getAllTracks } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';

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
            const clip = track.clips.find((c) => c.id === id);
            if (clip) {
                return clip;
            }
        }
        return undefined;
    }

    const state = midiStore.value;
    const notes: MidiNote[] = state?.notesByClipId[clipId] ?? [];

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
        velocityAccum[stepIndex]!.push(note.velocity / 100);
    }

    const offsets = offsetAccum.map((arr) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0));
    const velocities = velocityAccum.map((arr) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 1));

    return {
        id: `extracted-${clipId}`,
        name: `Extracted from ${clipId}`,
        subdivisions,
        offsets,
        velocities,
    };
}
