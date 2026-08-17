/**
 * Euclidean Rhythm Generator — distributes hits as evenly as possible across steps.
 * Uses Bjorklund's algorithm. Can drive the arp pattern or standalone note emission.
 */

import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import {
    EMIT_FALLBACK_BLOCK_SPAN_SAMPLES,
    resolveBlockEndSamples,
    resolveBlockStartSamples,
    ScheduledEventQueue,
} from '../MidiProcessor';

/** Bjorklund's algorithm — distribute `hits` across `steps` as evenly as possible. */
function bjorklund(hits: number, steps: number): boolean[] {
    if (hits >= steps) {
        return Array.from<boolean>({ length: steps }).fill(true);
    }
    if (hits <= 0) {
        return Array.from<boolean>({ length: steps }).fill(false);
    }

    // Bresenham-style even distribution
    const out: boolean[] = [];
    for (let index = 0; index < steps; index++) {
        // Toussaint's formulation: step i is a hit if floor(i*hits/steps) != floor((i-1)*hits/steps)
        const current = Math.floor(((index + 1) * hits) / steps);
        const previous = Math.floor((index * hits) / steps);
        out.push(current !== previous);
    }

    return out;
}

export class EuclideanGenerator extends BaseMidiProcessor {
    readonly name = 'Euclidean';

    private hits = 5;
    private steps = 8;
    private rotation = 0;
    private rate: RateValue = { type: 'straight', denom: 16 };
    private gate = 0.5;
    private note = 60; // C4
    private velocity = 100;
    private pattern: boolean[] = [];
    private stepIndex = 0;
    private lastStepTime = -Infinity;
    private scheduled = new ScheduledEventQueue();
    // Reused across blocks so the per-block scheduled drain allocates nothing.
    private readonly drainScratch: MidiEvent[] = [];

    constructor(id?: string) {
        super(id ?? `euclid-${Date.now()}`);
        this.rebuildPattern();
    }

    private rebuildPattern(): void {
        const base = bjorklund(this.hits, this.steps);
        // Apply rotation
        this.pattern = [];
        for (let index = 0; index < this.steps; index++) {
            this.pattern.push(base[(((index - this.rotation) % this.steps) + this.steps) % this.steps]!);
        }
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        // Pass through input
        for (const event of input) {
            output.push(event);
        }

        if (!transport.isPlaying) {
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

            if (this.pattern[this.stepIndex % this.pattern.length]) {
                const noteInstanceId = this.createGeneratedNoteInstanceId();
                output.push({
                    timeSamples: stepTime,
                    durationSamples: noteLen,
                    trackId: this.trackId,
                    noteInstanceId,
                    kind: { type: 'noteOn', channel: 0, note: this.note, velocity: this.velocity },
                });
                this.scheduled.push({
                    timeSamples: stepTime + noteLen,
                    trackId: this.trackId,
                    noteInstanceId,
                    kind: { type: 'noteOff', channel: 0, note: this.note },
                });
            }

            this.stepIndex = (this.stepIndex + 1) % this.steps;
            this.lastStepTime = stepTime;
        }

        // Drain scheduled Note Offs
        const drained = this.drainScratch;
        drained.length = 0;
        this.scheduled.drainRangeInto(0, blockEnd, drained, this.trackId);
        for (const event1 of drained) {
            output.push(event1);
        }
        drained.length = 0;
    }

    reset(): void {
        this.stepIndex = 0;
        this.lastStepTime = -Infinity;
        this.scheduled.clear();
    }

    protected resetParams(): void {
        this.hits = 5;
        this.steps = 8;
        this.rotation = 0;
        this.rate = { type: 'straight', denom: 16 };
        this.gate = 0.5;
        this.note = 60;
        this.velocity = 100;
        this.rebuildPattern();
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'hits':
                this.hits = Math.max(0, Math.min(32, Math.round(value)));
                this.rebuildPattern();
                break;
            case 'steps':
                this.steps = Math.max(1, Math.min(32, Math.round(value)));
                this.rebuildPattern();
                break;
            case 'rotation':
                this.rotation = Math.round(value);
                this.rebuildPattern();
                break;
            case 'rate_denom':
                this.rate = { ...this.rate, denom: Math.max(1, value) };
                break;
            case 'gate':
                this.gate = Math.max(0.01, Math.min(2, value));
                break;
            case 'note':
                this.note = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'velocity':
                this.velocity = Math.max(1, Math.min(127, Math.round(value)));
                break;
        }
    }

    /** Get current pattern for UI display. */
    getPattern(): boolean[] {
        return [...this.pattern];
    }
    getCurrentStep(): number {
        return this.stepIndex;
    }
}
