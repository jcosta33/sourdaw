/**
 * Chord Generator — builds chords from single input notes.
 * Supports voicing modes (close, drop 2, spread) and optional strum timing.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { type MidiProcessor } from '../../models/MidiProcessor';

const CHORD_FORMULAS: Record<string, number[]> = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    dom7: [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dim7: [0, 3, 6, 9],
    '9th': [0, 4, 7, 10, 14],
    '11th': [0, 4, 7, 10, 14, 17],
};

export class ChordGenerator implements MidiProcessor {
    readonly id: string;
    readonly name = 'Chord Generator';

    private chordType = 'major';
    private voicing: 'close' | 'drop2' | 'drop3' | 'spread' = 'close';
    private strumMs = 0; // 0 = no strum
    private strumDirection: 'up' | 'down' = 'up';
    private bypassed = false;
    // Track which notes we generated so we can send proper Note Offs
    private generatedMap = new Map<string, number[]>(); // "ch:note" → generated notes

    constructor(id?: string) {
        this.id = id ?? `chord-${Date.now()}`;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let intervals = [...(CHORD_FORMULAS[this.chordType] ?? [0, 4, 7])];

                // Apply voicing transforms
                if (this.voicing === 'drop2' && intervals.length >= 3) {
                    // Drop the 2nd-from-top note down an octave
                    const dropIdx = intervals.length - 2;
                    intervals[dropIdx] = intervals[dropIdx]! - 12;
                    intervals.sort((a, b) => a - b);
                } else if (this.voicing === 'drop3' && intervals.length >= 4) {
                    // Drop the 3rd-from-top note down an octave
                    const dropIdx = intervals.length - 3;
                    intervals[dropIdx] = intervals[dropIdx]! - 12;
                    intervals.sort((a, b) => a - b);
                } else if (this.voicing === 'spread' && intervals.length >= 3) {
                    // Spread: alternate octave offsets for wider voicing
                    intervals = intervals.map((intv, idx) => intv + (idx % 2 === 1 ? 12 : 0));
                }

                const strumSamples = this.strumMs * 0.001 * transport.sampleRate;
                const notes: number[] = [];

                for (let i = 0; i < intervals.length; i++) {
                    const note = event.kind.note + intervals[i]!;
                    if (note < 0 || note > 127) continue;
                    notes.push(note);

                    const offset =
                        this.strumDirection === 'up' ? i * strumSamples : (intervals.length - 1 - i) * strumSamples;
                    output.push({
                        timeSamples: event.timeSamples + offset,
                        kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                    });
                }

                this.generatedMap.set(`${event.kind.channel}:${event.kind.note}`, notes);
            } else if (event.kind.type === 'noteOff') {
                const key = `${event.kind.channel}:${event.kind.note}`;
                const generated = this.generatedMap.get(key);
                if (generated) {
                    for (const note of generated) {
                        output.push({
                            timeSamples: event.timeSamples,
                            kind: { type: 'noteOff', channel: event.kind.channel, note },
                        });
                    }
                    this.generatedMap.delete(key);
                } else {
                    output.push(event);
                }
            } else {
                output.push(event);
            }
        }
    }

    reset(): void {
        this.generatedMap.clear();
    }
    setBypassed(b: boolean): void {
        this.bypassed = b;
    }
    isBypassed(): boolean {
        return this.bypassed;
    }
    latencySamples(): number {
        return 0;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'chord_type': {
                const types = Object.keys(CHORD_FORMULAS);
                this.chordType = types[Math.round(value)] ?? 'major';
                break;
            }
            case 'voicing':
                this.voicing = (['close', 'drop2', 'drop3', 'spread'] as const)[Math.round(value)] ?? 'close';
                break;
            case 'strum_ms':
                this.strumMs = Math.max(0, Math.min(100, value));
                break;
            case 'strum_direction':
                this.strumDirection = value > 0.5 ? 'down' : 'up';
                break;
        }
    }
}
