/**
 * Scale Quantizer — constrains incoming notes to a musical scale.
 * Also supports diatonic transposition (move by scale degrees, not semitones).
 */

import { BaseMidiProcessor } from '../../models/BaseMidiProcessor';
import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';

const SCALE_PATTERNS: Record<string, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
    melodicMinor: [0, 2, 3, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonicMajor: [0, 2, 4, 7, 9],
    pentatonicMinor: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    wholeTone: [0, 2, 4, 6, 8, 10],
    diminished: [0, 2, 3, 5, 6, 8, 9, 11],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const SCALE_NAMES = Object.keys(SCALE_PATTERNS);

type RemapMode = 'nearest' | 'up' | 'down';

export class ScaleQuantizer extends BaseMidiProcessor {
    readonly name = 'Scale Quantizer';

    private root = 0; // 0-11 (C=0)
    private scaleName = 'major';
    private remapMode: RemapMode = 'nearest';
    private transpose = 0; // diatonic degrees
    // Track note mapping for proper Note Off
    private noteMap = new Map<number, number>(); // ch*128+inNote → outNote

    constructor(id?: string) {
        super(id ?? `scale-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        const pattern = SCALE_PATTERNS[this.scaleName] ?? SCALE_PATTERNS.major!;

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let note = this.quantizeToScale(event.kind.note, pattern);
                if (this.transpose !== 0) {
                    note = this.diatonicTranspose(note, this.transpose, pattern);
                }
                note = Math.max(0, Math.min(127, note));

                this.noteMap.set(event.kind.channel * 128 + event.kind.note, note);
                output.push({
                    timeSamples: event.timeSamples,
                    kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = event.kind.channel * 128 + event.kind.note;
                const mappedNote = this.noteMap.get(key) ?? event.kind.note;
                this.noteMap.delete(key);
                output.push({
                    timeSamples: event.timeSamples,
                    kind: { type: 'noteOff', channel: event.kind.channel, note: mappedNote },
                });
            } else {
                output.push(event);
            }
        }
    }

    private quantizeToScale(note: number, pattern: number[]): number {
        const pc = (((note - this.root) % 12) + 12) % 12;
        if (pattern.includes(pc)) {
            return note;
        }

        switch (this.remapMode) {
            case 'nearest': {
                let bestDist = 12;
                let bestNote = note;
                for (const scalePc of pattern) {
                    const dist = Math.min(Math.abs(pc - scalePc), 12 - Math.abs(pc - scalePc));
                    if (dist < bestDist) {
                        bestDist = dist;
                        const diff = scalePc - pc;
                        bestNote = note + (Math.abs(diff) <= 6 ? diff : diff > 0 ? diff - 12 : diff + 12);
                    }
                }
                return bestNote;
            }
            case 'up': {
                for (let offset = 1; offset <= 12; offset++) {
                    if (pattern.includes((((pc + offset) % 12) + 12) % 12)) {
                        return note + offset;
                    }
                }
                return note;
            }
            case 'down': {
                for (let offset = 1; offset <= 12; offset++) {
                    if (pattern.includes((((pc - offset) % 12) + 12) % 12)) {
                        return note - offset;
                    }
                }
                return note;
            }
        }
    }

    private diatonicTranspose(note: number, degrees: number, pattern: number[]): number {
        const pc = (((note - this.root) % 12) + 12) % 12;
        const octave = Math.floor((note - this.root) / 12);
        const degreeIdx = pattern.indexOf(pc);
        if (degreeIdx === -1) {
            return note;
        } // not in scale, pass through

        const newDegreeIdx = degreeIdx + degrees;
        const newOctaveOffset = Math.floor(newDegreeIdx / pattern.length);
        const wrappedIdx = ((newDegreeIdx % pattern.length) + pattern.length) % pattern.length;
        return this.root + (octave + newOctaveOffset) * 12 + pattern[wrappedIdx]!;
    }

    reset(): void {
        this.noteMap.clear();
    }
    setParam(name: string, value: number): void {
        switch (name) {
            case 'root':
                this.root = Math.round(value) % 12;
                break;
            case 'scale': {
                this.scaleName = SCALE_NAMES[Math.round(value)] ?? 'major';
                break;
            }
            case 'remap_mode':
                this.remapMode = (['nearest', 'up', 'down'] as const)[Math.round(value)] ?? 'nearest';
                break;
            case 'transpose':
                this.transpose = Math.round(value);
                break;
        }
    }
}
