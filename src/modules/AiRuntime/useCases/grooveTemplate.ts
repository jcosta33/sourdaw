import { midiStore } from '#/modules/Track/stores/midiStore';
import { getAllTracks } from '#/modules/Track/useCases/trackQueries';

/** Local type matching Track module's MidiNote shape, avoids cross-module model import. */
type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

export type GrooveTemplate = {
    id: string;
    name: string;
    subdivisions: number;
    offsets: number[];
    velocities: number[];
};

// ---------------------------------------------------------------------------
// Factory grooves
// ---------------------------------------------------------------------------

function fill(length: number, value: number): number[] {
    return Array.from({ length }, () => value);
}

const STRAIGHT_16: GrooveTemplate = {
    id: 'straight',
    name: 'Straight',
    subdivisions: 16,
    offsets: fill(16, 0),
    velocities: fill(16, 1),
};

const LIGHT_SWING: GrooveTemplate = {
    id: 'swing-light',
    name: 'Light Swing',
    subdivisions: 16,
    offsets: [0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03],
    velocities: [1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7],
};

const HEAVY_SWING: GrooveTemplate = {
    id: 'swing-heavy',
    name: 'Heavy Swing',
    subdivisions: 16,
    offsets: [0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08],
    velocities: [1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6],
};

const MPC_60: GrooveTemplate = {
    id: 'mpc-60',
    name: 'MPC 60 Feel',
    subdivisions: 16,
    offsets: [0, 0.04, 0, 0.02, 0, 0.04, 0, 0.03, 0, 0.04, 0, 0.02, 0, 0.04, 0, 0.03],
    velocities: [1.15, 0.75, 0.9, 0.7, 1.1, 0.75, 0.85, 0.7, 1.15, 0.75, 0.9, 0.7, 1.1, 0.75, 0.85, 0.7],
};

const SP_1200: GrooveTemplate = {
    id: 'sp-1200',
    name: 'SP-1200 Feel',
    subdivisions: 16,
    offsets: [0, -0.03, 0, -0.01, 0, -0.03, 0, -0.02, 0, -0.03, 0, -0.01, 0, -0.03, 0, -0.02],
    velocities: [1.1, 0.8, 0.95, 0.8, 1.05, 0.8, 0.9, 0.8, 1.1, 0.8, 0.95, 0.8, 1.05, 0.8, 0.9, 0.8],
};

const LIVE_DRUMMER: GrooveTemplate = {
    id: 'live-drummer',
    name: 'Live Drummer',
    subdivisions: 16,
    offsets: [
        0.01, -0.02, 0.015, -0.01, 0.02, -0.015, 0.005, -0.02, 0.015, -0.01, 0.02, -0.005, 0.01, -0.02, 0.015, -0.01,
    ],
    velocities: [1.05, 0.85, 0.95, 0.82, 1.08, 0.83, 0.92, 0.8, 1.06, 0.84, 0.93, 0.81, 1.07, 0.82, 0.94, 0.83],
};

export const FACTORY_GROOVES: GrooveTemplate[] = [STRAIGHT_16, LIGHT_SWING, HEAVY_SWING, MPC_60, SP_1200, LIVE_DRUMMER];

export function getGrooveById(grooveId: string): GrooveTemplate | undefined {
    return FACTORY_GROOVES.find((g) => g.id === grooveId);
}

// ---------------------------------------------------------------------------
// Extract groove from a clip's notes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Apply groove to a clip's notes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
