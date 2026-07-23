/**
 * Groove / Swing Module — applies timing offset templates to notes.
 * Receives canonical groove projections from MIDI through numeric runtime params.
 */

import {
    type MidiEvent,
    type TransportInfo,
    projectPpqToSamples,
    projectSamplesToPpq,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

export class GrooveModule extends BaseMidiProcessor {
    readonly name = 'Groove';

    private amount = 0.5; // 0–1 blend
    private stepBeats = 0.25;
    private slotCount = 16;
    private readonly timingOffsets = new Float64Array(32);
    private readonly dynamicsOffsets = new Float64Array(32);
    // Track timing offset for Note Off. Numeric key (channel << 7) | note matches
    // MidiRack/ScaleQuantizer and avoids a per-event template-literal allocation
    // on the audio thread.
    private noteVoices = new BoundedNoteVoiceQueue<number>();

    constructor(id?: string) {
        super(id ?? `groove-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        const beatLengthSamples = samplesPerBeat(transport);
        const blockStartSamples = transport.blockStartSamples;
        const timelineOffsetSamples =
            transport.tempoMap === undefined || blockStartSamples === undefined
                ? 0
                : blockStartSamples - projectPpqToSamples(transport.ppqPosition, transport);

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const sourcePpq =
                    transport.tempoMap === undefined
                        ? event.timePpq
                        : projectSamplesToPpq(event.timeSamples, transport);
                const beatPosition =
                    sourcePpq ??
                    (blockStartSamples === undefined
                        ? event.timeSamples / beatLengthSamples
                        : transport.ppqPosition + (event.timeSamples - blockStartSamples) / beatLengthSamples);
                const stepIndex = Math.round(beatPosition / this.stepBeats);
                const templateIndex = ((stepIndex % this.slotCount) + this.slotCount) % this.slotCount;
                const offsetBeats = this.timingOffsets[templateIndex]! * this.amount * this.stepBeats;
                const projectedPpq = sourcePpq === undefined ? undefined : sourcePpq + offsetBeats;
                const endpointBeatLengthSamples = (transport.sampleRate * 60) / (event.tempoBpm ?? transport.bpm);
                const projectedSamples =
                    projectedPpq === undefined || transport.tempoMap === undefined
                        ? event.timeSamples + Math.round(offsetBeats * endpointBeatLengthSamples)
                        : projectPpqToSamples(projectedPpq, transport) + timelineOffsetSamples;
                const velocityScale = 1 + this.dynamicsOffsets[templateIndex]! * this.amount;
                const velocity = Math.max(1, Math.min(127, Math.round(event.kind.velocity * velocityScale)));
                let durationSamples = event.durationSamples;
                let durationPpq = event.durationPpq;
                if (sourcePpq !== undefined && durationSamples !== undefined && transport.tempoMap !== undefined) {
                    durationPpq = projectSamplesToPpq(event.timeSamples + durationSamples, transport) - sourcePpq;
                    const projectedEndSamples =
                        projectPpqToSamples(sourcePpq + offsetBeats + durationPpq, transport) + timelineOffsetSamples;
                    durationSamples = Math.max(0, projectedEndSamples - projectedSamples);
                }

                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                this.noteVoices.push(event.trackId, key, offsetBeats);

                const transformed: MidiEvent = {
                    ...event,
                    timeSamples: projectedSamples,
                    durationSamples,
                    durationPpq,
                    timePpq: projectedPpq,
                    kind: { ...event.kind, velocity },
                };
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
            } else if (event.kind.type === 'noteOff') {
                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                const offsetBeats = this.noteVoices.shift(event.trackId, key) ?? 0;
                const sourcePpq =
                    transport.tempoMap === undefined
                        ? event.timePpq
                        : projectSamplesToPpq(event.timeSamples, transport);
                const projectedPpq = sourcePpq === undefined ? undefined : sourcePpq + offsetBeats;
                const endpointBeatLengthSamples = (transport.sampleRate * 60) / (event.tempoBpm ?? transport.bpm);
                const projectedSamples =
                    projectedPpq === undefined || transport.tempoMap === undefined
                        ? event.timeSamples + Math.round(offsetBeats * endpointBeatLengthSamples)
                        : projectPpqToSamples(projectedPpq, transport) + timelineOffsetSamples;

                const transformed: MidiEvent = {
                    ...event,
                    timeSamples: projectedSamples,
                    timePpq: projectedPpq,
                    kind: event.kind,
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
        this.amount = 0.5;
        this.stepBeats = 0.25;
        this.slotCount = 16;
        this.timingOffsets.fill(0);
        this.dynamicsOffsets.fill(0);
    }

    setParam(name: string, value: number): void {
        if (!Number.isFinite(value)) {
            return;
        }
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
