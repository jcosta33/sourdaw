/**
 * Transposer — simple pitch offset with optional random variation and clamping.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { type MidiProcessor } from '../../models/MidiProcessor';

export class Transposer implements MidiProcessor {
    readonly id: string;
    readonly name = 'Transposer';

    private semitones = 0;
    private octaves = 0;
    private randomRange = 0; // ±semitones random offset
    private clampMin = 0;
    private clampMax = 127;
    private bypassed = false;
    private rngState = 0xface;
    private noteMap = new Map<string, number>(); // "ch:inNote" → outNote

    constructor(id?: string) {
        this.id = id ?? `transpose-${Date.now()}`;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let offset = this.semitones + this.octaves * 12;
                if (this.randomRange > 0) {
                    this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
                    offset += (this.rngState % (this.randomRange * 2 + 1)) - this.randomRange;
                }

                const note = Math.max(this.clampMin, Math.min(this.clampMax, event.kind.note + offset));
                this.noteMap.set(`${event.kind.channel}:${event.kind.note}`, note);

                output.push({
                    timeSamples: event.timeSamples,
                    kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = `${event.kind.channel}:${event.kind.note}`;
                const note = this.noteMap.get(key) ?? event.kind.note;
                this.noteMap.delete(key);

                output.push({
                    timeSamples: event.timeSamples,
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
