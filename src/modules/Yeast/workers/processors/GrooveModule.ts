/**
 * Groove / Swing Module — applies timing offset templates to notes.
 * Receives canonical groove projections from MIDI through numeric runtime params.
 */

import { type MidiEvent, type TransportInfo, samplesPerBeat } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';

const MAX_PENDING_OFFSETS_PER_NOTE = 32;

type PendingNoteOffsets = {
    values: Int32Array;
    head: number;
    size: number;
    overflow: number;
};

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
    private noteMap = new Map<string | undefined, Map<number, PendingNoteOffsets>>();

    constructor(id?: string) {
        super(id ?? `groove-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        const beatLengthSamples = samplesPerBeat(transport);
        const stepLengthSamples = beatLengthSamples * this.stepBeats;
        const blockStartSamples = transport.blockStartSamples;

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const beatPos =
                    blockStartSamples === undefined
                        ? event.timeSamples / beatLengthSamples
                        : transport.ppqPosition + (event.timeSamples - blockStartSamples) / beatLengthSamples;
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
                this.enqueueOffset(event.trackId, key, offsetSamples);

                output.push({
                    timeSamples: event.timeSamples + offsetSamples,
                    trackId: event.trackId,
                    kind: { ...event.kind, velocity },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const offset = this.dequeueOffset(event.trackId, key);

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

    private enqueueOffset(trackId: string | undefined, key: number, offset: number): void {
        let routeMap = this.noteMap.get(trackId);
        if (!routeMap) {
            routeMap = new Map<number, PendingNoteOffsets>();
            this.noteMap.set(trackId, routeMap);
        }
        let pending = routeMap.get(key);
        if (!pending) {
            pending = {
                values: new Int32Array(MAX_PENDING_OFFSETS_PER_NOTE),
                head: 0,
                size: 0,
                overflow: 0,
            };
            routeMap.set(key, pending);
        }
        if (pending.overflow > 0 || pending.size === pending.values.length) {
            pending.overflow = Math.min(Number.MAX_SAFE_INTEGER, pending.overflow + 1);
            return;
        }
        const tail = (pending.head + pending.size) % pending.values.length;
        pending.values[tail] = offset;
        pending.size += 1;
    }

    private dequeueOffset(trackId: string | undefined, key: number): number {
        const routeMap = this.noteMap.get(trackId);
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
                this.noteMap.delete(trackId);
            }
        }
        return offset;
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
