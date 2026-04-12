/**
 * Markov Chain arpeggiator mode — chooses next note based on transition probabilities.
 * Creates recognizable patterns with controlled randomness, unlike pure random mode.
 */

import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { type MidiProcessor, ScheduledEventQueue } from '../../models/MidiProcessor';

const MAX_STATES = 12; // max pitch classes or held notes

export class MarkovChain implements MidiProcessor {
    readonly id: string;
    readonly name = 'Markov';

    // Transition matrix: probs[from][to] — each row sums to 1.0
    private probs: number[][] = [];
    private stateCount = 0;
    private currentState = 0;
    private rate: RateValue = { type: 'straight', denom: 8 };
    private gate = 0.7;
    private velocity = 100;
    private bypassed = false;
    private rngState = 0xabcd;
    private lastStepTime = -Infinity;
    private scheduled = new ScheduledEventQueue();

    // Map states to MIDI notes (from held notes or scale degrees)
    private stateToNote: number[] = [];
    private held: number[] = [];

    constructor(id?: string) {
        this.id = id ?? `markov-${Date.now()}`;
        this.initDefaultMatrix(7); // default: 7 notes (one octave scale)
    }

    private initDefaultMatrix(size: number): void {
        this.stateCount = Math.min(size, MAX_STATES);
        this.probs = [];
        for (let i = 0; i < this.stateCount; i++) {
            const row: number[] = [];
            for (let j = 0; j < this.stateCount; j++) {
                // Default: favor adjacent states, some probability for jumps
                const dist = Math.min(Math.abs(i - j), this.stateCount - Math.abs(i - j));
                row.push(dist === 0 ? 0.05 : dist === 1 ? 0.35 : dist === 2 ? 0.15 : 0.05);
            }
            // Normalize
            const sum = row.reduce((a, b) => a + b, 0);
            this.probs.push(row.map((v) => v / sum));
        }
    }

    private sampleNext(): number {
        if (this.stateCount === 0) {return 0;}
        const row = this.probs[this.currentState % this.stateCount];
        if (!row) {return 0;}

        this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
        let r = this.rngState / 0x7fffffff;
        let cumulative = 0;

        for (let i = 0; i < row.length; i++) {
            cumulative += row[i]!;
            if (r <= cumulative) {return i;}
        }
        return row.length - 1;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        // Track held notes to build state-to-note mapping
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                if (!this.held.includes(event.kind.note)) {
                    this.held.push(event.kind.note);
                    this.held.sort((a, b) => a - b);
                    this.stateToNote = [...this.held];
                    if (this.stateCount !== this.held.length) {
                        this.initDefaultMatrix(this.held.length);
                    }
                }
            } else if (event.kind.type === 'noteOff') {
                const offNote = event.kind.note;
                this.held = this.held.filter((n) => n !== offNote);
                // Don't update stateToNote on release (keep generating from last chord)
            } else {
                output.push(event);
            }
        }

        if (!transport.isPlaying || this.stateToNote.length === 0) {return;}

        const stepLen = rateToBeats(this.rate) * samplesPerBeat(transport);
        const noteLen = stepLen * this.gate;
        const now = input.length > 0 ? input[0]!.timeSamples : 0;
        const blockEnd = now + 128;

        if (this.lastStepTime === -Infinity) {this.lastStepTime = now;}

        let safety = 0;
        while (this.lastStepTime + stepLen <= blockEnd && safety < 64) {
            safety++;
            const stepTime = this.lastStepTime + stepLen;

            // Sample next state via Markov transition
            this.currentState = this.sampleNext();
            const note = this.stateToNote[this.currentState % this.stateToNote.length]!;

            output.push({
                timeSamples: stepTime,
                kind: { type: 'noteOn', channel: 0, note, velocity: this.velocity },
            });
            this.scheduled.push({
                timeSamples: stepTime + noteLen,
                kind: { type: 'noteOff', channel: 0, note },
            });

            this.lastStepTime = stepTime;
        }

        const drained = this.scheduled.drainRange(0, blockEnd);
        for (const e of drained) {output.push(e);}
    }

    reset(): void {
        this.currentState = 0;
        this.lastStepTime = -Infinity;
        this.held = [];
        this.stateToNote = [];
        this.scheduled.clear();
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
            case 'rate_denom':
                this.rate = { ...this.rate, denom: Math.max(1, value) };
                break;
            case 'gate':
                this.gate = Math.max(0.01, Math.min(2, value));
                break;
            case 'velocity':
                this.velocity = Math.max(1, Math.min(127, Math.round(value)));
                break;
        }
    }

    /** Set a specific transition probability. For UI matrix editor. */
    setTransition(from: number, to: number, prob: number): void {
        if (from < this.stateCount && to < this.stateCount && this.probs[from]) {
            this.probs[from]![to] = Math.max(0, prob);
            // Re-normalize row
            const row = this.probs[from]!;
            const sum = row.reduce((a, b) => a + b, 0);
            if (sum > 0) {
                for (let i = 0; i < row.length; i++) {row[i] = row[i]! / sum;}
            }
        }
    }

    /** Get the transition matrix for UI display. */
    getMatrix(): number[][] {
        return this.probs.map((r) => [...r]);
    }
    getCurrentState(): number {
        return this.currentState;
    }
    getStateCount(): number {
        return this.stateCount;
    }
}
