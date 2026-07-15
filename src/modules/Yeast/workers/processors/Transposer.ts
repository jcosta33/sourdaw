/**
 * Transposer — simple pitch offset with optional random variation and clamping.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { nextLcg } from '../lcgRandom';

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
    private noteMap = new Map<string | undefined, Map<number, number>>();

    constructor(id?: string) {
        super(id ?? `transpose-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let offset = this.semitones + this.octaves * 12;
                if (this.randomRange > 0) {
                    this.rngState = nextLcg(this.rngState);
                    offset += (this.rngState % (this.randomRange * 2 + 1)) - this.randomRange;
                }

                const note = Math.max(this.clampMin, Math.min(this.clampMax, event.kind.note + offset));
                const routeMap = this.noteMap.get(event.trackId) ?? new Map<number, number>();
                routeMap.set((event.kind.channel << 7) | event.kind.note, note);
                this.noteMap.set(event.trackId, routeMap);

                output.push({
                    timeSamples: event.timeSamples,
                    trackId: event.trackId,
                    kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const routeMap = this.noteMap.get(event.trackId);
                const note = routeMap?.get(key) ?? event.kind.note;
                routeMap?.delete(key);
                if (routeMap?.size === 0) {
                    this.noteMap.delete(event.trackId);
                }

                output.push({
                    timeSamples: event.timeSamples,
                    trackId: event.trackId,
                    kind: { type: 'noteOff', channel: event.kind.channel, note },
                });
            } else {
                output.push(event);
            }
        }
    }

    reset(): void {
        this.noteMap.clear();
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
