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
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { LCG_MAX, nextLcg } from '../lcgRandom';
import {
    EMIT_FALLBACK_BLOCK_SPAN_SAMPLES,
    resolveBlockEndSamples,
    resolveBlockStartSamples,
    ScheduledEventQueue,
} from '../MidiProcessor';

const MAX_STATES = 12; // max pitch classes or held notes

type HeldNote = {
    note: number;
    trackId?: string;
};

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
    // Reused across blocks so the per-block scheduled drain allocates nothing.
    private readonly drainScratch: MidiEvent[] = [];

    // Map states to MIDI notes (from held notes or scale degrees).
    // Pre-allocated at MAX_STATES; `stateNoteCount` tracks the active length.
    private readonly stateToNote: number[] = Array.from({ length: MAX_STATES }, () => 0);
    private readonly stateToTrack: Array<string | undefined> = Array.from({ length: MAX_STATES }, () => undefined);
    private stateNoteCount = 0;
    private held: HeldNote[] = [];

    constructor(id?: string) {
        super(id ?? `markov-${Date.now()}`);
        // Pre-allocate the full MAX_STATES × MAX_STATES matrix once
        this.probs = [];
        for (let index = 0; index < MAX_STATES; index++) {
            const row: number[] = Array.from({ length: MAX_STATES }, () => 0);
            this.probs.push(row);
        }
        this.fillDefaultMatrix(7); // default: 7 notes (one octave scale)
    }

    /** Fill the pre-allocated matrix with default transition probabilities for `size` states. */
    private fillDefaultMatrix(size: number): void {
        this.stateCount = Math.min(size, MAX_STATES);
        for (let index = 0; index < this.stateCount; index++) {
            const row = this.probs[index]!;
            let sum = 0;
            for (let jIndex = 0; jIndex < this.stateCount; jIndex++) {
                // Default: favor adjacent states, some probability for jumps
                const dist = Math.min(Math.abs(index - jIndex), this.stateCount - Math.abs(index - jIndex));
                const val = (() => {
                    if (dist === 0) {
                        return 0.05;
                    } else {
                        if (dist === 1) {
                            return 0.35;
                        } else {
                            if (dist === 2) {
                                return 0.15;
                            } else {
                                return 0.05;
                            }
                        }
                    }
                })();
                row[jIndex] = val;
                sum += val;
            }
            // Normalize row in-place
            if (sum > 0) {
                for (let jIndex = 0; jIndex < this.stateCount; jIndex++) {
                    row[jIndex] = row[jIndex]! / sum;
                }
            }
            // Zero out unused columns
            for (let jIndex = this.stateCount; jIndex < MAX_STATES; jIndex++) {
                row[jIndex] = 0;
            }
        }
        // Zero out unused rows
        for (let index = this.stateCount; index < MAX_STATES; index++) {
            const row = this.probs[index]!;
            for (let jIndex = 0; jIndex < MAX_STATES; jIndex++) {
                row[jIndex] = 0;
            }
        }
    }

    private sampleNext(): number {
        // Defensive guards. sampleNext is only reached after the
        // `stateNoteCount === 0` early-return in processMidi, so stateCount is
        // always >= 1 here; and probs is pre-allocated to MAX_STATES rows, so
        // `row` is never undefined. Both branches are therefore unreachable
        // through the public API but kept as audio-thread safety nets.
        if (this.stateCount === 0) {
            return 0;
        }
        const row = this.probs[this.currentState % this.stateCount];
        if (!row) {
            return 0;
        }

        this.rngState = nextLcg(this.rngState);
        const r = this.rngState / LCG_MAX;
        let cumulative = 0;

        for (let index = 0; index < this.stateCount; index++) {
            cumulative += row[index]!;
            if (r <= cumulative) {
                return index;
            }
        }
        return this.stateCount - 1;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        // Track held notes to build state-to-note mapping
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const note = event.kind.note;
                const trackId = event.trackId;
                if (!this.held.some((heldNote) => heldNote.note === note && heldNote.trackId === trackId)) {
                    this.held.push({ note, trackId });
                    this.held.sort((alpha, b) => alpha.note - b.note);
                    // Copy held notes into pre-allocated stateToNote buffer (no allocation)
                    this.stateNoteCount = Math.min(this.held.length, MAX_STATES);
                    for (let kIndex = 0; kIndex < this.stateNoteCount; kIndex++) {
                        const heldNote = this.held[kIndex]!;
                        this.stateToNote[kIndex] = heldNote.note;
                        this.stateToTrack[kIndex] = heldNote.trackId;
                    }
                    if (this.stateCount !== this.held.length) {
                        this.fillDefaultMatrix(this.held.length);
                    }
                }
            } else if (event.kind.type === 'noteOff') {
                // Audio-thread: in-place removal avoids allocating a new array
                const offNote = event.kind.note;
                const idx = this.held.findIndex(
                    (heldNote) => heldNote.note === offNote && heldNote.trackId === event.trackId
                );
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
        const now = resolveBlockStartSamples(transport, input);
        const blockEnd = resolveBlockEndSamples(transport, now, EMIT_FALLBACK_BLOCK_SPAN_SAMPLES);

        if (this.lastStepTime === -Infinity) {
            this.lastStepTime = now;
        }

        // Strictly `<`: the block is half-open, so a step landing exactly on
        // `blockEnd` belongs to the next block, not this one.
        let safety = 0;
        while (this.lastStepTime + stepLen < blockEnd && safety < 64) {
            safety++;
            const stepTime = this.lastStepTime + stepLen;

            // Sample next state via Markov transition
            this.currentState = this.sampleNext();
            const note = this.stateToNote[this.currentState % this.stateNoteCount]!;
            const noteInstanceId = this.createGeneratedNoteInstanceId();

            output.push({
                timeSamples: stepTime,
                durationSamples: noteLen,
                trackId: this.stateToTrack[this.currentState % this.stateNoteCount],
                noteInstanceId,
                kind: { type: 'noteOn', channel: 0, note, velocity: this.velocity },
            });
            this.scheduled.push({
                timeSamples: stepTime + noteLen,
                trackId: this.stateToTrack[this.currentState % this.stateNoteCount],
                noteInstanceId,
                kind: { type: 'noteOff', channel: 0, note },
            });

            this.lastStepTime = stepTime;
        }

        const drained = this.drainScratch;
        drained.length = 0;
        this.scheduled.drainRangeInto(0, blockEnd, drained, this.trackId);
        for (const event1 of drained) {
            output.push(event1);
        }
        drained.length = 0;
    }

    reset(): void {
        this.currentState = 0;
        this.lastStepTime = -Infinity;
        this.held = [];
        this.stateNoteCount = 0;
        this.scheduled.clear();
    }

    protected resetParams(): void {
        this.rate = { type: 'straight', denom: 8 };
        this.gate = 0.7;
        this.velocity = 100;
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
            for (let index = 0; index < this.stateCount; index++) {
                sum += row[index]!;
            }
            if (sum > 0) {
                for (let index = 0; index < this.stateCount; index++) {
                    row[index] = row[index]! / sum;
                }
            }
        }
    }

    /** Get the active portion of the transition matrix for UI display. */
    getMatrix(): number[][] {
        const result: number[][] = [];
        for (let index = 0; index < this.stateCount; index++) {
            result.push(this.probs[index]!.slice(0, this.stateCount));
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
