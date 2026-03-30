/**
 * Chord Memory — Cthulhu-style one-finger chord recall.
 *
 * Store a voicing per trigger key, then recall it with a single finger.
 * Optionally transpose stored chords relative to the original root.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { type MidiProcessor } from '../../models/MidiProcessor';

type StoredChord = {
    root: number;
    notes: number[];  // absolute MIDI notes
};

export class ChordMemory implements MidiProcessor {
    readonly id: string;
    readonly name = 'Chord Memory';

    private memory = new Map<number, StoredChord>(); // trigger note → stored chord
    private learning = false;
    private learnBuffer: number[] = [];
    private learnRoot = -1;
    private transposeMode = true; // transpose stored chord relative to trigger
    private bypassed = false;
    // Track active chords for Note Off
    private activeChords = new Map<string, number[]>(); // "ch:triggerNote" → emitted notes

    constructor(id?: string) {
        this.id = id ?? `chordmem-${Date.now()}`;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                if (this.learning) {
                    // Accumulate notes into learn buffer
                    if (this.learnRoot === -1) this.learnRoot = event.kind.note;
                    this.learnBuffer.push(event.kind.note);
                    // Don't output during learning
                    continue;
                }

                const stored = this.memory.get(event.kind.note);
                if (stored) {
                    const key = `${event.kind.channel}:${event.kind.note}`;
                    const emitted: number[] = [];
                    const transpose = this.transposeMode ? event.kind.note - stored.root : 0;

                    for (const n of stored.notes) {
                        const note = Math.max(0, Math.min(127, n + transpose));
                        emitted.push(note);
                        output.push({
                            timeSamples: event.timeSamples,
                            kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                        });
                    }
                    this.activeChords.set(key, emitted);
                } else {
                    // No memory for this key — pass through
                    output.push(event);
                }
            } else if (event.kind.type === 'noteOff') {
                if (this.learning) {
                    // On release during learning, finalize if buffer has notes
                    // (simplified: commit on first Note Off)
                    if (this.learnBuffer.length > 0 && this.learnRoot >= 0) {
                        this.memory.set(this.learnRoot, {
                            root: this.learnRoot,
                            notes: [...this.learnBuffer],
                        });
                        this.learnBuffer = [];
                        this.learnRoot = -1;
                        this.learning = false;
                    }
                    continue;
                }

                const key = `${event.kind.channel}:${event.kind.note}`;
                const emitted = this.activeChords.get(key);
                if (emitted) {
                    for (const note of emitted) {
                        output.push({
                            timeSamples: event.timeSamples,
                            kind: { type: 'noteOff', channel: event.kind.channel, note },
                        });
                    }
                    this.activeChords.delete(key);
                } else {
                    output.push(event);
                }
            } else {
                output.push(event);
            }
        }
    }

    reset(): void {
        this.activeChords.clear();
        this.learnBuffer = [];
        this.learnRoot = -1;
        this.learning = false;
    }

    setBypassed(b: boolean): void { this.bypassed = b; }
    isBypassed(): boolean { return this.bypassed; }
    latencySamples(): number { return 0; }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'learn': this.learning = value > 0.5; this.learnBuffer = []; this.learnRoot = -1; break;
            case 'transpose_mode': this.transposeMode = value > 0.5; break;
            case 'clear': if (value > 0.5) this.memory.clear(); break;
        }
    }

    /** Get stored chord count for UI. */
    getStoredCount(): number { return this.memory.size; }
    isLearning(): boolean { return this.learning; }
}
