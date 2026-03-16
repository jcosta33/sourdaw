import { addClip } from "#/modules/Track/useCases/clipUseCases";
import { addMidiNote } from "#/modules/Track/useCases/midiUseCases";

export type MelodyStyle = "simple" | "arpeggiated" | "stepwise" | "rhythmic" | "ambient";

export type ScaleType =
    | "major"
    | "minor"
    | "pentatonic"
    | "minor-pentatonic"
    | "blues"
    | "dorian"
    | "mixolydian";

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
    major:            [0, 2, 4, 5, 7, 9, 11],
    minor:            [0, 2, 3, 5, 7, 8, 10],
    pentatonic:       [0, 2, 4, 7, 9],
    "minor-pentatonic": [0, 3, 5, 7, 10],
    blues:            [0, 3, 5, 6, 7, 10],
    dorian:           [0, 2, 3, 5, 7, 9, 10],
    mixolydian:       [0, 2, 4, 5, 7, 9, 10],
};

const buildScaleNotesFromIntervals = (intervals: readonly number[], baseMidi: number, rangeSemitones: number): number[] => {
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
};

type RhythmSlot = { duration: number; isRest: boolean };

const buildRhythm = (style: MelodyStyle, totalBeats: number, density: number): RhythmSlot[] => {
    const slots: RhythmSlot[] = [];
    let position = 0;

    switch (style) {
        case "simple": {
            while (position < totalBeats) {
                const r = Math.random();
                const duration = r < 0.4 ? 1 : r < 0.7 ? 2 : 0.5;
                const isRest = Math.random() > density * 1.2;
                const clamped = Math.min(duration, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
            }
            break;
        }

        case "arpeggiated": {
            const subdivisionSize = density > 0.6 ? 0.25 : 0.5;
            while (position < totalBeats) {
                const isRest = Math.random() > density * 1.5;
                const clamped = Math.min(subdivisionSize, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
            }
            break;
        }

        case "stepwise": {
            while (position < totalBeats) {
                const duration = Math.random() < 0.7 ? 0.5 : 0.25;
                const isRest = Math.random() > density * 1.4;
                const clamped = Math.min(duration, totalBeats - position);
                if (clamped <= 0) {
                    break;
                }
                slots.push({ duration: clamped, isRest });
                position += clamped;
            }
            break;
        }

        case "rhythmic": {
            const rhythmCells = [0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5, 1];
            let cellIndex = 0;
            while (position < totalBeats) {
                const duration = rhythmCells[cellIndex % rhythmCells.length]!;
                const isRest = Math.random() > density * 1.3;
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

        case "ambient": {
            while (position < totalBeats) {
                const r = Math.random();
                const duration = r < 0.3 ? 4 : r < 0.6 ? 2 : 3;
                const isRest = Math.random() > density * 0.8;
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
};

const pickNextNote = (
    scaleNotes: number[],
    currentIndex: number,
    style: MelodyStyle,
): number => {
    const len = scaleNotes.length;
    if (len === 0) {
        return 0;
    }

    switch (style) {
        case "simple": {
            const stepWeights = [-2, -1, -1, 0, 1, 1, 2];
            const step = stepWeights[Math.floor(Math.random() * stepWeights.length)]!;
            return Math.max(0, Math.min(len - 1, currentIndex + step));
        }

        case "arpeggiated": {
            // Walk up through chord tones, wrap around
            const direction = Math.random() < 0.7 ? 1 : -1;
            const step = direction * (Math.random() < 0.5 ? 2 : 3);
            let next = currentIndex + step;
            if (next >= len) {
                next = next % len;
            }
            if (next < 0) {
                next = len + (next % len);
            }
            return next;
        }

        case "stepwise": {
            const direction = Math.random() < 0.6 ? 1 : -1;
            return Math.max(0, Math.min(len - 1, currentIndex + direction));
        }

        case "rhythmic": {
            // Favor repeated notes and small steps
            const r = Math.random();
            if (r < 0.3) {
                return currentIndex;
            }
            const step = Math.random() < 0.5 ? 1 : -1;
            return Math.max(0, Math.min(len - 1, currentIndex + step));
        }

        case "ambient": {
            // Wide intervals
            const step = Math.floor(Math.random() * 7) - 3;
            return Math.max(0, Math.min(len - 1, currentIndex + step));
        }
    }
};

const clampVelocity = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

const velocityForStyle = (style: MelodyStyle, beatPosition: number): number => {
    const isDownbeat = beatPosition % 1 === 0;

    switch (style) {
        case "simple":
            return clampVelocity(isDownbeat ? 90 + Math.random() * 10 : 75 + Math.random() * 15);
        case "arpeggiated":
            return clampVelocity(70 + Math.random() * 20);
        case "stepwise":
            return clampVelocity(80 + Math.random() * 15);
        case "rhythmic":
            return clampVelocity(isDownbeat ? 100 + Math.random() * 10 : 80 + Math.random() * 15);
        case "ambient":
            return clampVelocity(55 + Math.random() * 25);
    }
};

export const generateMelody = (options: GenerateMelodyOptions): GeneratedNote[] => {
    const {
        style,
        key,
        scale,
        octave = 4,
        bars = 4,
        density = 0.5,
        range = 12,
    } = options;

    const intervals = SCALE_INTERVALS[scale];
    const baseMidi = key + octave * 12;
    const scaleNotes = buildScaleNotesFromIntervals(intervals, baseMidi, range);

    if (scaleNotes.length === 0) {
        return [];
    }

    const beatsPerBar = 4;
    const totalBeats = bars * beatsPerBar;
    const rhythm = buildRhythm(style, totalBeats, density);

    const notes: GeneratedNote[] = [];
    let currentScaleIndex = Math.floor(scaleNotes.length / 2);
    let position = 0;

    for (const slot of rhythm) {
        if (!slot.isRest) {
            currentScaleIndex = pickNextNote(scaleNotes, currentScaleIndex, style);
            const pitch = scaleNotes[currentScaleIndex]!;
            const velocity = velocityForStyle(style, position);

            notes.push({
                pitch,
                startBeat: position,
                duration: slot.duration,
                velocity,
            });
        }
        position += slot.duration;
    }

    return notes;
};

export const applyMelodyToTrack = (trackId: string, options: GenerateMelodyOptions): void => {
    const bars = options.bars ?? 4;
    const totalBeats = bars * 4;

    const scaleName = options.scale.charAt(0).toUpperCase() + options.scale.slice(1);
    const keyNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const keyName = keyNames[options.key % 12] ?? "C";

    const clip = addClip({
        trackId,
        startBeat: 0,
        endBeat: totalBeats,
        name: `${options.style} melody (${keyName} ${scaleName})`,
        type: "midi",
    });

    if (!clip) {
        return;
    }

    const notes = generateMelody(options);
    for (const note of notes) {
        addMidiNote(clip.id, note.pitch, note.startBeat, note.duration, note.velocity);
    }
};
