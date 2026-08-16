/**
 * Transposer — simple pitch offset with optional random variation and clamping.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';
import { nextLcg } from '../lcgRandom';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

export class Transposer extends BaseMidiProcessor {
    readonly name = 'Transposer';

    private semitones = 0;
    private octaves = 0;
    private randomRange = 0; // ±semitones random offset
    private clampMin = 0;
    private clampMax = 127;
    private rngState = 0xface;
    // Numeric key (channel << 7) | inNote → outNote. Matches MidiRack/ScaleQuantizer
    // and avoids a per-event template-literal allocation on the audio thread.
    private noteVoices = new BoundedNoteVoiceQueue<number>();

    constructor(id?: string) {
        super(id ?? `transpose-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let offset = this.semitones + this.octaves * 12;
                if (this.randomRange > 0) {
                    this.rngState = nextLcg(this.rngState);
                    offset += (this.rngState % (this.randomRange * 2 + 1)) - this.randomRange;
                }

                // `clamp_min` and `clamp_max` are interchangeable ends of one
                // range, so read them in order. No UI reaches an inverted pair,
                // but a stored project, a CRDT merge, or an AI-authored action
                // can set one: the outer `Math.max` would then win outright and
                // pin every note to `clamp_min`, above the requested ceiling.
                const low = Math.min(this.clampMin, this.clampMax);
                const high = Math.max(this.clampMin, this.clampMax);
                const note = Math.max(low, Math.min(high, event.kind.note + offset));
                this.noteVoices.push(event.trackId, (event.kind.channel << 7) | event.kind.note, note);

                const transformed: MidiEvent = {
                    ...event,
                    kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                };
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const note = this.noteVoices.shift(event.trackId, key) ?? event.kind.note;

                const transformed: MidiEvent = {
                    ...event,
                    kind: { type: 'noteOff', channel: event.kind.channel, note },
                };
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
            } else {
                output.push(event);
            }
        }
    }

    reset(): void {
        this.noteVoices.clear();
    }

    protected resetParams(): void {
        this.semitones = 0;
        this.octaves = 0;
        this.randomRange = 0;
        this.clampMin = 0;
        this.clampMax = 127;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'semitones':
                this.semitones = Math.round(value);
                break;
            case 'octaves':
                this.octaves = Math.round(value);
                break;
            case 'random_range':
                this.randomRange = Math.max(0, Math.round(value));
                break;
            case 'clamp_min':
                this.clampMin = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'clamp_max':
                this.clampMax = Math.max(0, Math.min(127, Math.round(value)));
                break;
        }
    }
}
