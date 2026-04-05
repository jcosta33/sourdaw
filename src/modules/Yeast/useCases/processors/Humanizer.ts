/**
 * Humanizer — per-note timing and velocity variation using Gaussian distribution.
 * Makes mechanical MIDI feel more like a live performance.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { type MidiProcessor } from '../../models/MidiProcessor';

type HumanizePreset = 'tight' | 'loose' | 'drunk' | 'rushed' | 'laidBack';

const PRESETS: Record<HumanizePreset, { timingMeanMs: number; timingSigmaMs: number; velSigma: number }> = {
    tight: { timingMeanMs: 0, timingSigmaMs: 3, velSigma: 5 },
    loose: { timingMeanMs: 0, timingSigmaMs: 10, velSigma: 10 },
    drunk: { timingMeanMs: 2, timingSigmaMs: 18, velSigma: 15 },
    rushed: { timingMeanMs: -5, timingSigmaMs: 6, velSigma: 5 },
    laidBack: { timingMeanMs: 8, timingSigmaMs: 5, velSigma: 5 },
};

export class Humanizer implements MidiProcessor {
    readonly id: string;
    readonly name = 'Humanizer';

    private timingMeanMs = 0;
    private timingSigmaMs = 5;
    private velSigma = 8;
    private bypassed = false;
    private rngState = 0xcafe;
    // Track timing offsets for matching Note Offs
    private noteTimingMap = new Map<string, number>(); // "ch:note" → timing offset samples

    constructor(id?: string) {
        this.id = id ?? `humanize-${Date.now()}`;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const timingOffsetMs = this.gaussian(this.timingMeanMs, this.timingSigmaMs);
                const timingOffsetSamples = Math.round(timingOffsetMs * 0.001 * transport.sampleRate);
                const velOffset = Math.round(this.gaussian(0, this.velSigma));

                const key = `${event.kind.channel}:${event.kind.note}`;
                this.noteTimingMap.set(key, timingOffsetSamples);

                output.push({
                    timeSamples: event.timeSamples + timingOffsetSamples,
                    kind: {
                        type: 'noteOn',
                        channel: event.kind.channel,
                        note: event.kind.note,
                        velocity: Math.max(1, Math.min(127, event.kind.velocity + velOffset)),
                    },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = `${event.kind.channel}:${event.kind.note}`;
                const offset = this.noteTimingMap.get(key) ?? 0;
                this.noteTimingMap.delete(key);

                output.push({
                    timeSamples: event.timeSamples + offset,
                    kind: event.kind,
                });
            } else {
                output.push(event);
            }
        }
    }

    private gaussian(mean: number, sigma: number): number {
        // Box-Muller transform using LCG
        const u1 = this.nextRandom();
        const u2 = this.nextRandom();
        const z = Math.sqrt(-2 * Math.log(Math.max(1e-10, u1))) * Math.cos(2 * Math.PI * u2);
        return mean + sigma * z;
    }

    private nextRandom(): number {
        this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
        return this.rngState / 0x7fffffff;
    }

    reset(): void {
        this.noteTimingMap.clear();
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
            case 'timing_mean_ms':
                this.timingMeanMs = Math.max(-30, Math.min(30, value));
                break;
            case 'timing_sigma_ms':
                this.timingSigmaMs = Math.max(0, Math.min(30, value));
                break;
            case 'vel_sigma':
                this.velSigma = Math.max(0, Math.min(30, value));
                break;
            case 'preset': {
                const preset = (['tight', 'loose', 'drunk', 'rushed', 'laidBack'] as const)[Math.round(value)];
                if (preset && PRESETS[preset]) {
                    const p = PRESETS[preset];
                    this.timingMeanMs = p.timingMeanMs;
                    this.timingSigmaMs = p.timingSigmaMs;
                    this.velSigma = p.velSigma;
                }
                break;
            }
        }
    }
}
