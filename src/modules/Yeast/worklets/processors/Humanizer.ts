/**
 * Humanizer — per-note timing and velocity variation using Gaussian distribution.
 * Makes mechanical MIDI feel more like a live performance.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { gaussianLcg } from '../lcgRandom';

type HumanizePreset = 'tight' | 'loose' | 'drunk' | 'rushed' | 'laidBack';

/**
 * Upper bound on tracked Note On timing offsets. The key space is
 * (channel << 7) | note = 16 channels × 128 notes, so at most this many
 * distinct notes can be sounding at once. Anything beyond this is a stale
 * entry from a dropped Note Off (e.g. a transport seek before panic); we
 * evict the oldest to keep the map from growing unbounded across a session.
 */
const MAX_TRACKED_NOTES = 16 * 128;

const PRESETS: Record<HumanizePreset, { timingMeanMs: number; timingSigmaMs: number; velSigma: number }> = {
    tight: { timingMeanMs: 0, timingSigmaMs: 3, velSigma: 5 },
    loose: { timingMeanMs: 0, timingSigmaMs: 10, velSigma: 10 },
    drunk: { timingMeanMs: 2, timingSigmaMs: 18, velSigma: 15 },
    rushed: { timingMeanMs: -5, timingSigmaMs: 6, velSigma: 5 },
    laidBack: { timingMeanMs: 8, timingSigmaMs: 5, velSigma: 5 },
};

export class Humanizer extends BaseMidiProcessor {
    readonly name = 'Humanizer';

    private timingMeanMs = 0;
    private timingSigmaMs = 5;
    private velSigma = 8;
    private rngState = 0xcafe;
    // Track timing offsets for matching Note Offs.
    // Numeric key (channel << 7) | note matches MidiRack/ScaleQuantizer.
    private noteTimingMap = new Map<number, number>();

    constructor(id?: string) {
        super(id ?? `humanize-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const timingOffsetMs = this.gaussian(this.timingMeanMs, this.timingSigmaMs);
                const timingOffsetSamples = Math.round(timingOffsetMs * 0.001 * transport.sampleRate);
                const velOffset = Math.round(this.gaussian(0, this.velSigma));

                const key = (event.kind.channel << 7) | event.kind.note;
                // Bound the map: a dropped Note Off (e.g. a transport seek before
                // panic) would otherwise leave a stale entry forever. Evict the
                // oldest tracked note once we exceed the live-note ceiling.
                if (!this.noteTimingMap.has(key) && this.noteTimingMap.size >= MAX_TRACKED_NOTES) {
                    // size >= ceiling (> 0) ⇒ the map is non-empty, so the iterator
                    // yields a real oldest key (insertion order). Evict it. The
                    // `!== undefined` guard narrows the IteratorResult value type;
                    // it can never actually be undefined given the size check.
                    const oldest = this.noteTimingMap.keys().next().value;
                    if (oldest !== undefined) {
                        this.noteTimingMap.delete(oldest);
                    }
                }
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
                const key = (event.kind.channel << 7) | event.kind.note;
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
        const { value, state } = gaussianLcg(this.rngState, mean, sigma);
        this.rngState = state;
        return value;
    }

    reset(): void {
        this.noteTimingMap.clear();
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
                    const param = PRESETS[preset];
                    this.timingMeanMs = param.timingMeanMs;
                    this.timingSigmaMs = param.timingSigmaMs;
                    this.velSigma = param.velSigma;
                }
                break;
            }
        }
    }
}
