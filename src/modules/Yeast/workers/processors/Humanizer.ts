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
const MAX_PENDING_OFFSETS_PER_NOTE = 64;

type PendingTimingOffsets = {
    values: Float64Array;
    head: number;
    size: number;
    overflow: number;
};

function hashIdentity(value: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash & 0x7fffffff;
}

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
    private noteTimingMap = new Map<string | undefined, Map<number, PendingTimingOffsets>>();
    private noteInstanceTimingMap = new Map<string, number>();

    constructor(id?: string) {
        super(id ?? `humanize-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let timingOffsetMs: number;
                let velOffsetValue: number;
                if (event.noteInstanceId) {
                    const identity = `${this.id}\u0000${event.trackId ?? ''}\u0000${event.noteInstanceId}`;
                    const timingResult = gaussianLcg(hashIdentity(identity), this.timingMeanMs, this.timingSigmaMs);
                    const velocityResult = gaussianLcg(timingResult.state, 0, this.velSigma);
                    timingOffsetMs = timingResult.value;
                    velOffsetValue = velocityResult.value;
                } else {
                    timingOffsetMs = this.gaussian(this.timingMeanMs, this.timingSigmaMs);
                    velOffsetValue = this.gaussian(0, this.velSigma);
                }
                const timingOffsetSamples = Math.round(timingOffsetMs * 0.001 * transport.sampleRate);
                const velOffset = Math.round(velOffsetValue);

                const key = (event.kind.channel << 7) | event.kind.note;
                let acceptedOffset: number;
                if (event.noteInstanceId) {
                    acceptedOffset = this.setInstanceOffset(event.trackId, event.noteInstanceId, timingOffsetSamples);
                } else {
                    acceptedOffset = this.enqueueOffset(event.trackId, key, timingOffsetSamples);
                }
                const timingOffsetBeats = (acceptedOffset * transport.bpm) / (transport.sampleRate * 60);

                output.push({
                    ...event,
                    timeSamples: event.timeSamples + acceptedOffset,
                    timePpq: event.timePpq === undefined ? undefined : event.timePpq + timingOffsetBeats,
                    kind: {
                        type: 'noteOn',
                        channel: event.kind.channel,
                        note: event.kind.note,
                        velocity: Math.max(1, Math.min(127, event.kind.velocity + velOffset)),
                    },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                let offset: number;
                if (event.noteInstanceId) {
                    offset = this.takeInstanceOffset(event.trackId, event.noteInstanceId);
                } else {
                    offset = this.dequeueOffset(event.trackId, key);
                }
                const timingOffsetBeats = (offset * transport.bpm) / (transport.sampleRate * 60);

                output.push({
                    ...event,
                    timeSamples: event.timeSamples + offset,
                    timePpq: event.timePpq === undefined ? undefined : event.timePpq + timingOffsetBeats,
                    kind: event.kind,
                });
            } else {
                output.push(event);
            }
        }
    }

    private instanceKey(trackId: string | undefined, noteInstanceId: string): string {
        return `${trackId ?? ''}\u0000${noteInstanceId}`;
    }

    private setInstanceOffset(trackId: string | undefined, noteInstanceId: string, offset: number): number {
        const key = this.instanceKey(trackId, noteInstanceId);
        if (!this.noteInstanceTimingMap.has(key) && this.noteInstanceTimingMap.size >= MAX_TRACKED_NOTES) {
            return 0;
        }
        this.noteInstanceTimingMap.set(key, offset);
        return offset;
    }

    private takeInstanceOffset(trackId: string | undefined, noteInstanceId: string): number {
        const key = this.instanceKey(trackId, noteInstanceId);
        const offset = this.noteInstanceTimingMap.get(key) ?? 0;
        this.noteInstanceTimingMap.delete(key);
        return offset;
    }

    private enqueueOffset(trackId: string | undefined, key: number, offset: number): number {
        let routeMap = this.noteTimingMap.get(trackId);
        if (!routeMap) {
            routeMap = new Map<number, PendingTimingOffsets>();
            this.noteTimingMap.set(trackId, routeMap);
        }
        let pending = routeMap.get(key);
        if (!pending) {
            if (routeMap.size >= MAX_TRACKED_NOTES) {
                const oldest = routeMap.keys().next().value;
                if (oldest !== undefined) {
                    routeMap.delete(oldest);
                }
            }
            pending = {
                values: new Float64Array(MAX_PENDING_OFFSETS_PER_NOTE),
                head: 0,
                size: 0,
                overflow: 0,
            };
            routeMap.set(key, pending);
        }
        if (pending.overflow > 0 || pending.size === pending.values.length) {
            pending.overflow = Math.min(Number.MAX_SAFE_INTEGER, pending.overflow + 1);
            return 0;
        }
        const tail = (pending.head + pending.size) % pending.values.length;
        pending.values[tail] = offset;
        pending.size += 1;
        return offset;
    }

    private dequeueOffset(trackId: string | undefined, key: number): number {
        const routeMap = this.noteTimingMap.get(trackId);
        const pending = routeMap?.get(key);
        if (!routeMap || !pending) {
            return 0;
        }
        let offset = 0;
        if (pending.size > 0) {
            offset = pending.values[pending.head] ?? 0;
            pending.head = (pending.head + 1) % pending.values.length;
            pending.size -= 1;
        } else if (pending.overflow > 0) {
            pending.overflow -= 1;
        }
        if (pending.size === 0 && pending.overflow === 0) {
            routeMap.delete(key);
            if (routeMap.size === 0) {
                this.noteTimingMap.delete(trackId);
            }
        }
        return offset;
    }

    private gaussian(mean: number, sigma: number): number {
        const { value, state } = gaussianLcg(this.rngState, mean, sigma);
        this.rngState = state;
        return value;
    }

    reset(): void {
        this.noteTimingMap.clear();
        this.noteInstanceTimingMap.clear();
    }

    protected resetParams(): void {
        this.timingMeanMs = 0;
        this.timingSigmaMs = 5;
        this.velSigma = 8;
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
