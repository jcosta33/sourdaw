/**
 * Markov Chain arpeggiator mode — chooses next note based on transition probabilities.
 * Creates recognizable patterns with controlled randomness, unlike pure random mode.
 */

import { BaseMidiProcessor } from '../../models/BaseMidiProcessor';
import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { ScheduledEventQueue } from '../../models/MidiProcessor';

const MAX_STATES = 12; // max pitch classes or held notes

export class MarkovChain extends BaseMidiProcessor {
    readonly name = 'Markov';

    // Transition matrix: probs[from][to] — pre-allocated at MAX_STATES × MAX_STATES.
    // Only the first `stateCount` rows/cols are active. Reused across chord changes
    // to avoid allocating a new number[][] on the audio thread.
    private readonly probs: number[][];
    private stateCount = 0;
    private currentState = 0;
    private rate: RateValue = { type: 'straight', denom: 8 };
    private gate = 0.7;
    private velocity = 100;
    private rngState = 0xabcd;
    private lastStepTime = -Infinity;
    private scheduled = new ScheduledEventQueue();

    // Map states to MIDI notes (from held notes or scale degrees).
    // Pre-allocated at MAX_STATES; `stateNoteCount` tracks the active length.
    private readonly stateToNote: number[] = Array.from({ length: MAX_STATES }, () => 0);
    private stateNoteCount = 0;
    private held: number[] = [];

    constructor(id?: string) {
        super(id ?? `markov-${Date.now()}`);
        // Pre-allocate the full MAX_STATES × MAX_STATES matrix once
        this.probs = [];
        for (let i = 0; i < MAX_STATES; i++) {
            const row: number[] = Array.from({ length: MAX_STATES }, () => 0);
            this.probs.push(row);
        }
        this.fillDefaultMatrix(7); // default: 7 notes (one octave scale)
    }

    /** Fill the pre-allocated matrix with default transition probabilities for `size` states. */
    private fillDefaultMatrix(size: number): void {
        this.stateCount = Math.min(size, MAX_STATES);
        for (let i = 0; i < this.stateCount; i++) {
            const row = this.probs[i]!;
            let sum = 0;
            for (let j = 0; j < this.stateCount; j++) {
                // Default: favor adjacent states, some probability for jumps
                const dist = Math.min(Math.abs(i - j), this.stateCount - Math.abs(i - j));
                const val = dist === 0 ? 0.05 : dist === 1 ? 0.35 : dist === 2 ? 0.15 : 0.05;
                row[j] = val;
                sum += val;
            }
            // Normalize row in-place
            if (sum > 0) {
                for (let j = 0; j < this.stateCount; j++) {
                    row[j] = row[j]! / sum;
                }
            }
            // Zero out unused columns
            for (let j = this.stateCount; j < MAX_STATES; j++) {
                row[j] = 0;
            }
        }
        // Zero out unused rows
        for (let i = this.stateCount; i < MAX_STATES; i++) {
            const row = this.probs[i]!;
            for (let j = 0; j < MAX_STATES; j++) {
                row[j] = 0;
            }
        }
    }

    private sampleNext(): number {
        if (this.stateCount === 0) {
            return 0;
        }
        const row = this.probs[this.currentState % this.stateCount];
        if (!row) {
            return 0;
        }

        this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
        const r = this.rngState / 0x7fffffff;
        let cumulative = 0;

        for (let i = 0; i < this.stateCount; i++) {
            cumulative += row[i]!;
            if (r <= cumulative) {
                return i;
            }
        }
        return this.stateCount - 1;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        // Track held notes to build state-to-note mapping
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                if (!this.held.includes(event.kind.note)) {
                    this.held.push(event.kind.note);
                    this.held.sort((a, b) => a - b);
                    // Copy held notes into pre-allocated stateToNote buffer (no allocation)
                    this.stateNoteCount = Math.min(this.held.length, MAX_STATES);
                    for (let k = 0; k < this.stateNoteCount; k++) {
                        this.stateToNote[k] = this.held[k]!;
                    }
                    if (this.stateCount !== this.held.length) {
                        this.fillDefaultMatrix(this.held.length);
                    }
                }
            } else if (event.kind.type === 'noteOff') {
                // Audio-thread: in-place removal avoids allocating a new array
                const offNote = event.kind.note;
                const idx = this.held.indexOf(offNote);
                if (idx !== -1) {
                    this.held.splice(idx, 1);
                }
                // Don't update stateToNote on release (keep generating from last chord)
            } else {
                output.push(event);
            }
        }

        if (!transport.isPlaying || this.stateNoteCount === 0) {
            return;
        }

        const stepLen = rateToBeats(this.rate) * samplesPerBeat(transport);
        const noteLen = stepLen * this.gate;
        const now = input.length > 0 ? input[0]!.timeSamples : 0;
        const blockEnd = now + 128;

        if (this.lastStepTime === -Infinity) {
            this.lastStepTime = now;
        }

        let safety = 0;
        while (this.lastStepTime + stepLen <= blockEnd && safety < 64) {
            safety++;
            const stepTime = this.lastStepTime + stepLen;

            // Sample next state via Markov transition
            this.currentState = this.sampleNext();
            const note = this.stateToNote[this.currentState % this.stateNoteCount]!;

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
        for (const e of drained) {
            output.push(e);
        }
    }

    reset(): void {
        this.currentState = 0;
        this.lastStepTime = -Infinity;
        this.held = [];
        this.stateNoteCount = 0;
        this.scheduled.clear();
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
            this.probs[from][to] = Math.max(0, prob);
            // Re-normalize active portion of row
            const row = this.probs[from];
            let sum = 0;
            for (let i = 0; i < this.stateCount; i++) {
                sum += row[i]!;
            }
            if (sum > 0) {
                for (let i = 0; i < this.stateCount; i++) {
                    row[i] = row[i]! / sum;
                }
            }
        }
    }

    /** Get the active portion of the transition matrix for UI display. */
    getMatrix(): number[][] {
        const result: number[][] = [];
        for (let i = 0; i < this.stateCount; i++) {
            result.push(this.probs[i]!.slice(0, this.stateCount));
        }
        return result;
    }
    getCurrentState(): number {
        return this.currentState;
    }
    getStateCount(): number {
        return this.stateCount;
    }
}
