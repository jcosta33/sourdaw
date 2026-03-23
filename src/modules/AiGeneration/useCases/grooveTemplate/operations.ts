import { midiStore } from '#/modules/Midi/stores/midiStore';
import { getAllTracks } from '#/modules/Track/useCases/trackQueries';
import { type GrooveTemplate } from './types';

/** Local type matching Track module's MidiNote shape, avoids cross-module model import. */
type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

function findClip(clipId: string) {
    const tracks = getAllTracks();
    for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

export function extractGroove(clipId: string, subdivisions = 16): GrooveTemplate {
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

export function applyGroove(clipId: string, template: GrooveTemplate, amount = 1.0): void {
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
        const stepIndex = ((nearestStep % template.subdivisions) + template.subdivisions) % template.subdivisions;

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
