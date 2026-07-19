/**
 * Groove / Swing Module — applies timing offset templates to notes.
 * Receives canonical groove projections from MIDI through numeric runtime params.
 */

import { type MidiEvent, type TransportInfo, samplesPerBeat } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';

export class GrooveModule extends BaseMidiProcessor {
    readonly name = 'Groove';

    private amount = 0.5; // 0–1 blend
    private stepBeats = 0.25;
    private slotCount = 16;
    private timingOffsets = new Float64Array(32);
    private dynamicsOffsets = new Float64Array(32);
    // Track timing offset for Note Off. Numeric key (channel << 7) | note matches
    // MidiRack/ScaleQuantizer and avoids a per-event template-literal allocation
    // on the audio thread.
    private noteMap = new Map<string | undefined, Map<number, number>>();

    constructor(id?: string) {
        super(id ?? `groove-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        const stepLengthSamples = samplesPerBeat(transport) * this.stepBeats;

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                // Determine which step this note falls on
                const beatPos = event.timeSamples / samplesPerBeat(transport);
                const stepIdx = Math.round(beatPos / this.stepBeats);
                const templateIdx = ((stepIdx % this.slotCount) + this.slotCount) % this.slotCount;
                const offset = this.timingOffsets[templateIdx]! * this.amount * stepLengthSamples;
                const offsetSamples = Math.round(offset);
                const velocity = Math.max(
                    1,
                    Math.min(
                        127,
                        Math.round(event.kind.velocity + this.dynamicsOffsets[templateIdx]! * 127 * this.amount)
                    )
                );

                const key = (event.kind.channel << 7) | event.kind.note;
                const routeMap = this.noteMap.get(event.trackId) ?? new Map<number, number>();
                routeMap.set(key, offsetSamples);
                this.noteMap.set(event.trackId, routeMap);

                output.push({
                    timeSamples: event.timeSamples + offsetSamples,
                    trackId: event.trackId,
                    kind: { ...event.kind, velocity },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const routeMap = this.noteMap.get(event.trackId);
                const offset = routeMap?.get(key) ?? 0;
                routeMap?.delete(key);
                if (routeMap?.size === 0) {
                    this.noteMap.delete(event.trackId);
                }

                output.push({
                    timeSamples: event.timeSamples + offset,
                    trackId: event.trackId,
                    kind: event.kind,
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
        this.amount = 0.5;
        this.stepBeats = 0.25;
        this.slotCount = 16;
        this.timingOffsets.fill(0);
        this.dynamicsOffsets.fill(0);
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'groove_amount':
                this.amount = Math.max(0, Math.min(1, value));
                break;
            case 'groove_step_beats':
                this.stepBeats = Math.max(1 / 32, Math.min(1, value));
                break;
            case 'groove_slot_count':
                this.slotCount = Math.max(1, Math.min(this.timingOffsets.length, Math.round(value)));
                break;
            default:
                this.setProjectionOffset(name, value);
        }
    }

    private setProjectionOffset(name: string, value: number): void {
        const timingIndex = name.startsWith('groove_timing_') ? Number(name.slice('groove_timing_'.length)) : -1;
        if (Number.isInteger(timingIndex) && timingIndex >= 0 && timingIndex < this.timingOffsets.length) {
            this.timingOffsets[timingIndex] = Math.max(-0.5, Math.min(0.5, value));
            return;
        }
        const dynamicsIndex = name.startsWith('groove_dynamics_') ? Number(name.slice('groove_dynamics_'.length)) : -1;
        if (Number.isInteger(dynamicsIndex) && dynamicsIndex >= 0 && dynamicsIndex < this.dynamicsOffsets.length) {
            this.dynamicsOffsets[dynamicsIndex] = Math.max(-1, Math.min(1, value));
        }
    }
}
