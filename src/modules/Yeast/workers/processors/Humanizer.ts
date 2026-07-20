/**
 * Humanizer — per-note timing and velocity variation using Gaussian distribution.
 * Makes mechanical MIDI feel more like a live performance.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';
import { gaussianLcg } from '../lcgRandom';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

type HumanizePreset = 'tight' | 'loose' | 'drunk' | 'rushed' | 'laidBack';

/**
 * Upper bound for identity and legacy timing state. Capacity exhaustion clears
 * timing state and disables timing shifts until reset, avoiding corrupt pair
 * matching without throwing from ordinary MIDI processing.
 */
const MAX_TRACKED_NOTES = 16 * 128;

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
    private noteTimingVoices = new BoundedNoteVoiceQueue<number>(MAX_TRACKED_NOTES);
    private noteInstanceTimingMap = new Map<string, number>();
    private timingTrackingDisabled = false;

    constructor(id?: string) {
        super(id ?? `humanize-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let timingOffsetMs: number;
                let velocityOffsetValue: number;
                if (event.noteInstanceId) {
                    const identity = `${this.id}\u0000${event.trackId ?? ''}\u0000${event.noteInstanceId}`;
                    const timingResult = gaussianLcg(hashIdentity(identity), this.timingMeanMs, this.timingSigmaMs);
                    const velocityResult = gaussianLcg(timingResult.state, 0, this.velSigma);
                    timingOffsetMs = timingResult.value;
                    velocityOffsetValue = velocityResult.value;
                } else {
                    timingOffsetMs = this.gaussian(this.timingMeanMs, this.timingSigmaMs);
                    velocityOffsetValue = this.gaussian(0, this.velSigma);
                }
                const timingOffsetSamples = Math.round(timingOffsetMs * 0.001 * transport.sampleRate);
                const velocityOffset = Math.round(velocityOffsetValue);

                const key = (event.kind.channel << 7) | event.kind.note;
                const acceptedOffset = event.noteInstanceId
                    ? this.setInstanceOffset(event.trackId, event.noteInstanceId, timingOffsetSamples)
                    : this.enqueueLegacyOffset(event.trackId, key, timingOffsetSamples);

                const transformed: MidiEvent = {
                    ...event,
                    timeSamples: event.timeSamples + acceptedOffset,
                    kind: {
                        type: 'noteOn',
                        channel: event.kind.channel,
                        note: event.kind.note,
                        velocity: Math.max(1, Math.min(127, event.kind.velocity + velocityOffset)),
                    },
                };
                if (event.timePpq !== undefined) {
                    const endpointTempo = event.tempoBpm ?? transport.bpm;
                    transformed.timePpq =
                        event.timePpq + (acceptedOffset * endpointTempo) / (transport.sampleRate * 60);
                }
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
                continue;
            }

            if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const offset = event.noteInstanceId
                    ? this.takeInstanceOffset(event.trackId, event.noteInstanceId)
                    : (this.noteTimingVoices.shift(event.trackId, key) ?? 0);

                const transformed: MidiEvent = {
                    ...event,
                    timeSamples: event.timeSamples + offset,
                    kind: event.kind,
                };
                if (event.timePpq !== undefined) {
                    const endpointTempo = event.tempoBpm ?? transport.bpm;
                    transformed.timePpq = event.timePpq + (offset * endpointTempo) / (transport.sampleRate * 60);
                }
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
                continue;
            }

            output.push(event);
        }
    }

    private instanceKey(trackId: string | undefined, noteInstanceId: string): string {
        return `${trackId ?? ''}\u0000${noteInstanceId}`;
    }

    private hasTimingCapacity(): boolean {
        return this.noteTimingVoices.size + this.noteInstanceTimingMap.size < MAX_TRACKED_NOTES;
    }

    private disableTimingTracking(): void {
        this.noteTimingVoices.clear();
        this.noteInstanceTimingMap.clear();
        this.timingTrackingDisabled = true;
    }

    private setInstanceOffset(trackId: string | undefined, noteInstanceId: string, offset: number): number {
        if (this.timingTrackingDisabled) {
            return 0;
        }
        const key = this.instanceKey(trackId, noteInstanceId);
        if (!this.noteInstanceTimingMap.has(key) && !this.hasTimingCapacity()) {
            this.disableTimingTracking();
            return 0;
        }
        this.noteInstanceTimingMap.set(key, offset);
        return offset;
    }

    private enqueueLegacyOffset(trackId: string | undefined, key: number, offset: number): number {
        if (this.timingTrackingDisabled) {
            return 0;
        }
        if (!this.hasTimingCapacity() || !this.noteTimingVoices.tryPush(trackId, key, offset)) {
            this.disableTimingTracking();
            return 0;
        }
        return offset;
    }

    private takeInstanceOffset(trackId: string | undefined, noteInstanceId: string): number {
        if (this.timingTrackingDisabled) {
            return 0;
        }
        const key = this.instanceKey(trackId, noteInstanceId);
        const offset = this.noteInstanceTimingMap.get(key) ?? 0;
        this.noteInstanceTimingMap.delete(key);
        return offset;
    }

    private gaussian(mean: number, sigma: number): number {
        const { value, state } = gaussianLcg(this.rngState, mean, sigma);
        this.rngState = state;
        return value;
    }

    reset(): void {
        this.noteTimingVoices.clear();
        this.noteInstanceTimingMap.clear();
        this.timingTrackingDisabled = false;
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
                if (preset) {
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
