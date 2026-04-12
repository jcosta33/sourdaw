/**
 * CC Generator / LFO — generates CC messages from a modulation shape.
 * Supports synced and free-running rates, multiple waveforms, note retrigger.
 */

import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { type MidiProcessor } from '../../models/MidiProcessor';

type LfoShape = 'sine' | 'triangle' | 'square' | 'sawUp' | 'sawDown' | 'sampleHold';

function evalShape(shape: LfoShape, phase: number, rngState: { v: number }): number {
    const p = phase % 1.0;
    switch (shape) {
        case 'sine':
            return 0.5 + 0.5 * Math.sin(p * 2 * Math.PI);
        case 'triangle':
            return p < 0.5 ? p * 2 : 2 - p * 2;
        case 'square':
            return p < 0.5 ? 1 : 0;
        case 'sawUp':
            return p;
        case 'sawDown':
            return 1 - p;
        case 'sampleHold': {
            // Only change on phase wrap
            if (p < 0.01) {
                rngState.v = ((rngState.v * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
            }
            return rngState.v;
        }
    }
}

export class CCGenerator implements MidiProcessor {
    readonly id: string;
    readonly name = 'CC Generator';

    private ccNumber = 1; // mod wheel default
    private shape: LfoShape = 'sine';
    private rate: RateValue = { type: 'straight', denom: 4 };
    private freeRateHz = 1.0;
    private syncMode = true; // true = tempo sync, false = free Hz
    private min = 0;
    private max = 127;
    private phase = 0;
    private retriggerOnNote = false;
    private bypassed = false;
    private lastEmittedValue = -1;
    private changeThreshold = 2; // only emit when value changes by this much
    private rng = { v: 0.5 };
    private accumPhase = 0;

    constructor(id?: string) {
        this.id = id ?? `ccgen-${Date.now()}`;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        // Pass through all input events
        for (const event of input) {
            output.push(event);

            // Retrigger phase on Note On
            if (this.retriggerOnNote && event.kind.type === 'noteOn') {
                this.accumPhase = 0;
            }
        }

        if (!transport.isPlaying) {return;}

        // Compute how much phase advances per sample
        const phasePerSample = this.syncMode
            ? 1.0 / (rateToBeats(this.rate) * samplesPerBeat(transport))
            : this.freeRateHz / transport.sampleRate;

        // Emit CC at subdivision boundaries (every ~64 samples to avoid flooding)
        const emitInterval = 64;
        const blockSamples = 128;
        const baseTime = input.length > 0 ? input[0]!.timeSamples : 0;

        for (let offset = 0; offset < blockSamples; offset += emitInterval) {
            this.accumPhase += phasePerSample * emitInterval;
            const currentPhase = (this.accumPhase + this.phase) % 1.0;
            const normalized = evalShape(this.shape, currentPhase, this.rng);
            const ccValue = Math.round(this.min + normalized * (this.max - this.min));

            if (Math.abs(ccValue - this.lastEmittedValue) >= this.changeThreshold) {
                this.lastEmittedValue = ccValue;
                output.push({
                    timeSamples: baseTime + offset,
                    kind: { type: 'cc', channel: 0, cc: this.ccNumber, value: Math.max(0, Math.min(127, ccValue)) },
                });
            }
        }
    }

    reset(): void {
        this.accumPhase = 0;
        this.lastEmittedValue = -1;
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
            case 'cc_number':
                this.ccNumber = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'shape':
                this.shape =
                    (['sine', 'triangle', 'square', 'sawUp', 'sawDown', 'sampleHold'] as const)[Math.round(value)] ??
                    'sine';
                break;
            case 'rate_denom':
                this.rate = { ...this.rate, denom: Math.max(1, value) };
                break;
            case 'free_rate_hz':
                this.freeRateHz = Math.max(0.01, Math.min(20, value));
                break;
            case 'sync':
                this.syncMode = value > 0.5;
                break;
            case 'min':
                this.min = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'max':
                this.max = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'phase':
                this.phase = Math.max(0, Math.min(1, value));
                break;
            case 'retrigger':
                this.retriggerOnNote = value > 0.5;
                break;
        }
    }
}
