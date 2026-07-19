/**
 * Groove / Swing Module — applies timing offset templates to notes.
 * Receives canonical groove projections from MIDI through numeric runtime params.
 */

import { type MidiEvent, type TransportInfo, samplesPerBeat } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';

const MAX_PENDING_OFFSETS_PER_NOTE = 32;
const MAX_PENDING_NOTE_INSTANCES = 2_048;

type PendingNoteOffsets = {
    values: Float64Array;
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
    private noteInstanceOffsets = new Map<string, number>();

    constructor(id?: string) {
        super(id ?? `groove-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        const beatLengthSamples = samplesPerBeat(transport);
        const blockStartSamples = transport.blockStartSamples;

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const beatPos =
                    event.timePpq ??
                    (blockStartSamples === undefined
                        ? event.timeSamples / beatLengthSamples
                        : transport.ppqPosition + (event.timeSamples - blockStartSamples) / beatLengthSamples);
                const stepIdx = Math.round(beatPos / this.stepBeats);
                const templateIdx = ((stepIdx % this.slotCount) + this.slotCount) % this.slotCount;
                const requestedOffsetBeats = this.timingOffsets[templateIdx]! * this.amount * this.stepBeats;
                const key = (event.kind.channel << 7) | event.kind.note;
                const offsetBeats = event.noteInstanceId
                    ? this.setInstanceOffset(event.trackId, event.noteInstanceId, requestedOffsetBeats)
                    : this.enqueueOffset(event.trackId, key, requestedOffsetBeats);
                const endpointBeatLengthSamples = (transport.sampleRate * 60) / (event.tempoBpm ?? transport.bpm);
                const offsetSamples = Math.round(offsetBeats * endpointBeatLengthSamples);
                const velocity = Math.max(
                    1,
                    Math.min(
                        127,
                        Math.round(event.kind.velocity + this.dynamicsOffsets[templateIdx]! * 127 * this.amount)
                    )
                );

                output.push({
                    ...event,
                    timeSamples: event.timeSamples + offsetSamples,
                    timePpq: event.timePpq === undefined ? undefined : event.timePpq + offsetBeats,
                    kind: { ...event.kind, velocity },
                });
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const offsetBeats = event.noteInstanceId
                    ? this.takeInstanceOffset(event.trackId, event.noteInstanceId)
                    : this.dequeueOffset(event.trackId, key);
                const endpointBeatLengthSamples = (transport.sampleRate * 60) / (event.tempoBpm ?? transport.bpm);
                const offsetSamples = Math.round(offsetBeats * endpointBeatLengthSamples);

                output.push({
                    ...event,
                    timeSamples: event.timeSamples + offsetSamples,
                    timePpq: event.timePpq === undefined ? undefined : event.timePpq + offsetBeats,
                    kind: event.kind,
                });
            } else {
                output.push(event);
            }
        }
    }

    private enqueueOffset(trackId: string | undefined, key: number, offset: number): number {
        let routeMap = this.noteMap.get(trackId);
        if (!routeMap) {
            routeMap = new Map<number, PendingNoteOffsets>();
            this.noteMap.set(trackId, routeMap);
        }
        let pending = routeMap.get(key);
        if (!pending) {
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

    private getInstanceKey(trackId: string | undefined, noteInstanceId: string): string {
        return `${trackId ?? ''}\u0000${noteInstanceId}`;
    }

    private setInstanceOffset(trackId: string | undefined, noteInstanceId: string, offset: number): number {
        const key = this.getInstanceKey(trackId, noteInstanceId);
        if (!this.noteInstanceOffsets.has(key) && this.noteInstanceOffsets.size >= MAX_PENDING_NOTE_INSTANCES) {
            return 0;
        }
        this.noteInstanceOffsets.set(key, offset);
        return offset;
    }

    private takeInstanceOffset(trackId: string | undefined, noteInstanceId: string): number {
        const key = this.getInstanceKey(trackId, noteInstanceId);
        const offset = this.noteInstanceOffsets.get(key) ?? 0;
        this.noteInstanceOffsets.delete(key);
        return offset;
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
        this.noteInstanceOffsets.clear();
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
