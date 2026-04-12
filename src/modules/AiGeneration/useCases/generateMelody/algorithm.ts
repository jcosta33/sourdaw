/**
 * Melody generation algorithm.
 * Accepts an optional seed for deterministic, reproducible output.
 */

import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

export type MelodyStyle = 'simple' | 'arpeggiated' | 'stepwise' | 'rhythmic' | 'ambient';

export type ScaleType =
    | 'major'
    | 'minor'
    | 'pentatonic'
    | 'minor-pentatonic'
    | 'blues'
    | 'dorian'
    | 'mixolydian'
    | 'lydian'
    | 'phrygian'
    | 'locrian'
    | 'harmonic-minor'
    | 'melodic-minor'
    | 'whole-tone'
    | 'chromatic';

export type GenerateMelodyOptions = {
    style: MelodyStyle;
    key: number;
    scale: ScaleType;
    octave?: number;
    bars?: number;
    density?: number;
    range?: number;
};

type GeneratedNote = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

const SCALE_INTERVALS: Record<ScaleType, readonly number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    'minor-pentatonic': [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
    'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
    'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
    'whole-tone': [0, 2, 4, 6, 8, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

function buildScaleNotesFromIntervals(
    intervals: readonly number[],
    baseMidi: number,
    rangeSemitones: number
): number[] {
    const notes: number[] = [];
    const octaveSize = 12;

    for (let semitone = 0; semitone <= rangeSemitones; semitone++) {
        const octaveOffset = Math.floor(semitone / octaveSize);
        const withinOctave = semitone % octaveSize;
        if (intervals.includes(withinOctave)) {
            const midi = baseMidi + octaveOffset * octaveSize + withinOctave;
            if (midi >= 0 && midi <= 127) {
                notes.push(midi);
            }
        }
    }

    return notes;
}

type RhythmSlot = { duration: number; isRest: boolean };

function buildRhythm(style: MelodyStyle, totalBeats: number, density: number, rng: () => number): RhythmSlot[] {
    const slots: RhythmSlot[] = [];
    let position = 0;

    switch (style) {
        case 'simple': {
            while (position < totalBeats) {
                const r = rng();
                const duration = r < 0.4 ? 1 : r < 0.7 ? 2 : 0.5;
                const isRest = rng() > density * 1.2;
                const clamped = Math.min(duration, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
            }
            break;
        }

        case 'arpeggiated': {
            const subdivisionSize = density > 0.6 ? 0.25 : 0.5;
            while (position < totalBeats) {
                const isRest = rng() > density * 1.5;
                const clamped = Math.min(subdivisionSize, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
            }
            break;
        }

        case 'stepwise': {
            while (position < totalBeats) {
                const duration = rng() < 0.7 ? 0.5 : 0.25;
                const isRest = rng() > density * 1.4;
                const clamped = Math.min(duration, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
            }
            break;
        }

        case 'rhythmic': {
            const rhythmCells = [0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5, 1];
            let cellIndex = 0;
            while (position < totalBeats) {
                const duration = rhythmCells[cellIndex % rhythmCells.length]!;
                const isRest = rng() > density * 1.3;
                const clamped = Math.min(duration, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
                cellIndex++;
            }
            break;
        }

        case 'ambient': {
            while (position < totalBeats) {
                const r = rng();
                const duration = r < 0.3 ? 4 : r < 0.6 ? 2 : 3;
                const isRest = rng() > density * 0.8;
                const clamped = Math.min(duration, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
            }
            break;
        }
    }

    return slots;
}

function pickNextNote(scaleNotes: number[], currentIndex: number, style: MelodyStyle, rng: () => number): number {
    const len = scaleNotes.length;
    if (len === 0) {
        return 0;
    }

    switch (style) {
        case 'simple': {
            const stepWeights = [-2, -1, -1, 0, 1, 1, 2];
            const step = stepWeights[Math.floor(rng() * stepWeights.length)]!;
            return Math.max(0, Math.min(len - 1, currentIndex + step));
        }

        case 'arpeggiated': {
            const direction = rng() < 0.7 ? 1 : -1;
            const step = direction * (rng() < 0.5 ? 2 : 3);
            let next = currentIndex + step;
            if (next >= len) {
                next = next % len;
            }
            if (next < 0) {
                next = len + (next % len);
            }
            return next;
        }

        case 'stepwise': {
            const direction = rng() < 0.6 ? 1 : -1;
            return Math.max(0, Math.min(len - 1, currentIndex + direction));
        }

        case 'rhythmic': {
            const r = rng();
            if (r < 0.3) {
                return currentIndex;
            }
            const step = rng() < 0.5 ? 1 : -1;
            return Math.max(0, Math.min(len - 1, currentIndex + step));
        }

        case 'ambient': {
            const step = Math.floor(rng() * 7) - 3;
            return Math.max(0, Math.min(len - 1, currentIndex + step));
        }
    }
}

const clampVelocity = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

function velocityForStyle(style: MelodyStyle, beatPosition: number, rng: () => number): number {
    const isDownbeat = beatPosition % 1 === 0;

    switch (style) {
        case 'simple':
            return clampVelocity(isDownbeat ? 90 + rng() * 10 : 75 + rng() * 15);
        case 'arpeggiated':
            return clampVelocity(70 + rng() * 20);
        case 'stepwise':
            return clampVelocity(80 + rng() * 15);
        case 'rhythmic':
            return clampVelocity(isDownbeat ? 100 + rng() * 10 : 80 + rng() * 15);
        case 'ambient':
            return clampVelocity(55 + rng() * 25);
    }
}

export function generateMelody(options: GenerateMelodyOptions & { seed?: number }): {
    notes: GeneratedNote[];
    seed: number;
} {
    const { style, key, scale, octave = 4, bars = 4, density = 0.5, range = 12, seed } = options;
    const usedSeed = seed ?? generateSeed();
    const rng = createSeededRandom(usedSeed);

    const intervals = SCALE_INTERVALS[scale];
    const baseMidi = key + octave * 12;
    const scaleNotes = buildScaleNotesFromIntervals(intervals, baseMidi, range);

    if (scaleNotes.length === 0) {
        return { notes: [], seed: usedSeed };
    }

    const beatsPerBar = 4;
    const totalBeats = bars * beatsPerBar;
    const rhythm = buildRhythm(style, totalBeats, density, rng);

    const notes: GeneratedNote[] = [];
    let currentScaleIndex = Math.floor(scaleNotes.length / 2);
    let position = 0;

    for (const slot of rhythm) {
        if (!slot.isRest) {
            currentScaleIndex = pickNextNote(scaleNotes, currentScaleIndex, style, rng);
            const pitch = scaleNotes[currentScaleIndex]!;
            const velocity = velocityForStyle(style, position, rng);

            notes.push({
                pitch,
                startBeat: position,
                duration: slot.duration,
                velocity,
            });
        }
        position += slot.duration;
    }

    return { notes, seed: usedSeed };
}
