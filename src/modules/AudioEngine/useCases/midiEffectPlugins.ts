/**
 * MIDI Effect Plugins.
 * Pure TypeScript MIDI processing plugins that transform MIDI events
 * before they reach an instrument.
 *
 * Each effect takes MIDI notes/events and outputs transformed notes/events.
 *
 * TODO: These are DATA-LAYER FACTORIES ONLY — not yet wired into the engine.
 *   The objects returned by .create() are never stored on any track, and
 *   .process() is never invoked during MIDI clip playback.
 *   To implement: tracks need a MidiEffect[] chain, and the scheduler must
 *   pipe notes through it before sending to the WAM instrument.
 *   See web-audio-engine SKILL.md for scheduling architecture.
 */

export type MidiNote = {
    pitch: number;
    velocity: number;
    startBeat: number;
    durationBeats: number;
    channel: number;
};

export type MidiEffect = {
    id: string;
    name: string;
    process: (notes: MidiNote[]) => MidiNote[];
};

// ─── Chord Generator ──────────────────────────────────────

const CHORD_INTERVALS: Record<string, number[]> = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    '7': [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
};

export function createChordGenerator(chordType = 'major'): MidiEffect {
    const intervals = CHORD_INTERVALS[chordType] ?? [0, 4, 7];
    return {
        id: 'midi-fx-chord-gen',
        name: `Chord Generator (${chordType})`,
        process: (notes) => {
            const result: MidiNote[] = [];
            for (const note of notes) {
                for (const interval of intervals) {
                    result.push({ ...note, pitch: note.pitch + interval });
                }
            }
            return result;
        },
    };
}

// ─── Scale Filter ─────────────────────────────────────────

const SCALES: Record<string, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 5, 6, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export function createScaleFilter(root = 0, scaleName = 'major'): MidiEffect {
    const scaleNotes = SCALES[scaleName] ?? SCALES.major!;
    return {
        id: 'midi-fx-scale-filter',
        name: `Scale Filter (${scaleName}, root ${root})`,
        process: (notes) => notes.filter((n) => scaleNotes.includes((n.pitch - root + 12) % 12)),
    };
}

// ─── Velocity Curve ───────────────────────────────────────

export function createVelocityCurve(
    curve: 'linear' | 'soft' | 'hard' | 'fixed' = 'linear',
    fixedVel = 100
): MidiEffect {
    return {
        id: 'midi-fx-velocity-curve',
        name: `Velocity Curve (${curve})`,
        process: (notes) =>
            notes.map((n) => {
                let vel = n.velocity;
                switch (curve) {
                    case 'soft':
                        vel = Math.round(Math.sqrt(vel / 127) * 127);
                        break;
                    case 'hard':
                        vel = Math.round((vel / 127) ** 2 * 127);
                        break;
                    case 'fixed':
                        vel = fixedVel;
                        break;
                    case 'linear':
                    default:
                        break;
                }
                return { ...n, velocity: Math.max(1, Math.min(127, vel)) };
            }),
    };
}

// ─── MIDI Delay ───────────────────────────────────────────

export function createMidiDelay(delayBeats = 0.25, repeats = 3, decay = 0.7): MidiEffect {
    return {
        id: 'midi-fx-delay',
        name: `MIDI Delay (${delayBeats}b × ${repeats})`,
        process: (notes) => {
            const result: MidiNote[] = [...notes];
            for (const note of notes) {
                for (let r = 1; r <= repeats; r++) {
                    result.push({
                        ...note,
                        startBeat: note.startBeat + delayBeats * r,
                        velocity: Math.max(1, Math.round(note.velocity * decay ** r)),
                    });
                }
            }
            return result;
        },
    };
}

// ─── Note Quantizer ───────────────────────────────────────

export function createNoteQuantizer(gridBeats = 0.25, strength = 1.0): MidiEffect {
    return {
        id: 'midi-fx-quantizer',
        name: `Note Quantizer (${gridBeats}b, ${Math.round(strength * 100)}%)`,
        process: (notes) =>
            notes.map((n) => {
                const quantized = Math.round(n.startBeat / gridBeats) * gridBeats;
                const newStart = n.startBeat + (quantized - n.startBeat) * strength;
                return { ...n, startBeat: newStart };
            }),
    };
}

// ─── Transpose ────────────────────────────────────────────

export function createTranspose(semitones = 0): MidiEffect {
    return {
        id: 'midi-fx-transpose',
        name: `Transpose (${semitones > 0 ? '+' : ''}${semitones})`,
        process: (notes) =>
            notes.map((n) => ({
                ...n,
                pitch: Math.max(0, Math.min(127, n.pitch + semitones)),
            })),
    };
}

// ─── CC Map ───────────────────────────────────────────────

export function createCCMap(inputCC: number, outputCC: number, _invert = false): MidiEffect {
    return {
        id: 'midi-fx-cc-map',
        name: `CC Map (${inputCC} → ${outputCC})`,
        // CC mapping operates on CC events, not notes
        // This is a placeholder for the note-level interface
        process: (notes) => notes,
    };
}

// ─── Registry ─────────────────────────────────────────────

export const MIDI_EFFECT_FACTORIES = [
    { id: 'chord-gen', name: 'Chord Generator', create: () => createChordGenerator() },
    { id: 'scale-filter', name: 'Scale Filter', create: () => createScaleFilter() },
    { id: 'velocity-curve', name: 'Velocity Curve', create: () => createVelocityCurve() },
    { id: 'midi-delay', name: 'MIDI Delay', create: () => createMidiDelay() },
    { id: 'quantizer', name: 'Note Quantizer', create: () => createNoteQuantizer() },
    { id: 'transpose', name: 'Transpose', create: () => createTranspose() },
    { id: 'cc-map', name: 'CC Map', create: () => createCCMap(1, 11) },
] as const;
