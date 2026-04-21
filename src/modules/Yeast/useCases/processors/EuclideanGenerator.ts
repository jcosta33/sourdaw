/**
 * Euclidean Rhythm Generator — distributes hits as evenly as possible across steps.
 * Uses Bjorklund's algorithm. Can drive the arp pattern or standalone note emission.
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

/** Bjorklund's algorithm — distribute `hits` across `steps` as evenly as possible. */
function bjorklund(hits: number, steps: number): boolean[] {
    if (hits >= steps) {
        return new Array(steps).fill(true);
    }
    if (hits <= 0) {
        return new Array(steps).fill(false);
    }

    const pattern: boolean[][] = [];
    for (let index = 0; index < steps; index++) {
        pattern.push([index < hits]);
    }

    let level = 0;
    const counts: number[] = [];
    const remainders: number[] = [];

    // Build counts/remainders
    remainders.push(steps - hits);
    counts.push(hits);
    while (remainders[remainders.length - 1]! > 1) {
        const context = counts[level]!;
        const r = remainders[level]!;
        counts.push(Math.min(context, r));
        remainders.push(Math.max(context, r) - Math.min(context, r));
        level++;
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
        const now = input.length > 0 ? input[0]!.timeSamples : 0;
        const blockEnd = now + 128;

        if (this.lastStepTime === -Infinity) {
            this.lastStepTime = now;
        }

        let safety = 0;
        while (this.lastStepTime + stepLen <= blockEnd && safety < 64) {
            safety++;
            const stepTime = this.lastStepTime + stepLen;

            if (this.pattern[this.stepIndex % this.pattern.length]) {
                output.push({
                    timeSamples: stepTime,
                    kind: { type: 'noteOn', channel: 0, note: this.note, velocity: this.velocity },
                });
                this.scheduled.push({
                    timeSamples: stepTime + noteLen,
                    kind: { type: 'noteOff', channel: 0, note: this.note },
                });
            }

            this.stepIndex = (this.stepIndex + 1) % this.steps;
            this.lastStepTime = stepTime;
        }

        // Drain scheduled Note Offs
        const drained = this.scheduled.drainRange(0, blockEnd);
        for (const event1 of drained) {
            output.push(event1);
        }
    }

    reset(): void {
        this.stepIndex = 0;
        this.lastStepTime = -Infinity;
        this.scheduled.clear();
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
