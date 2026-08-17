/**
 * Note Repeater / Echo — repeats incoming notes at intervals with velocity decay.
 * Supports pitch offset per repeat and synced/free rate.
 */

import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import {
    DRAIN_FALLBACK_BLOCK_SPAN_SAMPLES,
    resolveBlockEndSamples,
    resolveBlockStartSamples,
    ScheduledEventQueue,
} from '../MidiProcessor';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

const SCHEDULED_LINEAGE_CAPACITY = 512;

export class NoteRepeater extends BaseMidiProcessor {
    readonly name = 'Note Repeater';

    private repeatCount = 3;
    private rate: RateValue = { type: 'straight', denom: 16 };
    private decay = 0.7; // velocity decay per repeat
    private gate = 0.5; // note length as fraction of interval
    private pitchStep = 0; // semitones per repeat
    private scheduled = new ScheduledEventQueue();
    // Reused across blocks so the per-block scheduled drain allocates nothing.
    private readonly drainScratch: MidiEvent[] = [];
    private readonly scheduledLineageEvent: Array<MidiEvent | undefined> = Array.from(
        { length: SCHEDULED_LINEAGE_CAPACITY },
        () => undefined
    );
    private readonly scheduledLineageToken = new Float64Array(SCHEDULED_LINEAGE_CAPACITY);
    private readonly scheduledLineageDuration = new Float64Array(SCHEDULED_LINEAGE_CAPACITY);
    private scheduledLineageCount = 0;
    private scheduledLineageCompromised = false;
    private lineageOwner: YeastPreviewDecisionSink | undefined;

    constructor(id?: string) {
        super(id ?? `repeater-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        const intervalSamples = rateToBeats(this.rate) * samplesPerBeat(transport);
        const noteLenSamples = intervalSamples * this.gate;

        for (const event of input) {
            // Pass through the original event
            output.push(event);

            if (event.kind.type === 'noteOn') {
                const availableLineageSlots = SCHEDULED_LINEAGE_CAPACITY - this.scheduledLineageCount;
                const storedRepeats = Math.min(this.repeatCount, availableLineageSlots);
                const lineage = preview?.retainDecisionLineage(event, storedRepeats);
                if (lineage !== undefined) {
                    this.lineageOwner = preview;
                }
                // Generate repeats
                for (let r = 1; r <= this.repeatCount; r++) {
                    const time = event.timeSamples + r * intervalSamples;
                    const vel = Math.max(1, Math.round(event.kind.velocity * this.decay ** r));
                    const note = Math.max(0, Math.min(127, event.kind.note + r * this.pitchStep));
                    const noteInstanceId = this.createGeneratedNoteInstanceId();

                    // Schedule Note On
                    const noteOn: MidiEvent = {
                        timeSamples: time,
                        durationSamples: noteLenSamples,
                        trackId: event.trackId,
                        noteInstanceId,
                        kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: vel },
                    };
                    this.scheduled.push(noteOn);
                    if (lineage !== undefined && this.scheduledLineageCount < SCHEDULED_LINEAGE_CAPACITY) {
                        const slot = this.scheduledLineageCount++;
                        this.scheduledLineageEvent[slot] = noteOn;
                        this.scheduledLineageToken[slot] = lineage;
                        this.scheduledLineageDuration[slot] = noteLenSamples;
                    } else if (lineage !== undefined) {
                        this.scheduledLineageCompromised = true;
                    }

                    // Schedule Note Off
                    this.scheduled.push({
                        timeSamples: time + noteLenSamples,
                        trackId: event.trackId,
                        noteInstanceId,
                        kind: { type: 'noteOff', channel: event.kind.channel, note },
                    });
                }
            }
        }

        // Drain scheduled events for this block. Bound the window by the
        // transport's block range (MidiRack always sets it) instead of a
        // "generous" now+8192 guess: draining repeats early with timeSamples
        // beyond the rack's block end parked them in the rack-level scheduled
        // queue, which re-feeds them through the chain top on later blocks —
        // every echo re-entered as fresh input and retriggered the repeater
        // exponentially until the rack's voice-capacity throw. Draining
        // exactly this block keeps each echo inside the block that contains
        // it, so it leaves the rack as final output and never re-enters.
        const now = resolveBlockStartSamples(transport, input);
        const blockEnd = resolveBlockEndSamples(transport, now, DRAIN_FALLBACK_BLOCK_SPAN_SAMPLES);
        const drained = this.drainScratch;
        drained.length = 0;
        this.scheduled.drainRangeInto(0, blockEnd, drained, this.trackId);
        for (const event1 of drained) {
            output.push(event1);
            const lineageIndex = this.findScheduledLineage(event1);
            if (lineageIndex !== -1) {
                const lineage = this.scheduledLineageToken[lineageIndex]!;
                if (preview) {
                    preview.restoreDecisionLineage(lineage, event1, this.scheduledLineageDuration[lineageIndex]);
                } else {
                    this.lineageOwner?.releaseDecisionLineage(lineage);
                }
                this.removeScheduledLineage(lineageIndex);
            } else if (event1.kind.type === 'noteOn' && this.scheduledLineageCompromised) {
                preview?.restoreDecisionLineage(-1, event1, noteLenSamples);
            }
        }
        drained.length = 0;
    }

    reset(): void {
        this.scheduled.clear();
        for (let index = 0; index < this.scheduledLineageCount; index++) {
            this.lineageOwner?.releaseDecisionLineage(this.scheduledLineageToken[index]!);
            this.scheduledLineageEvent[index] = undefined;
        }
        this.scheduledLineageCount = 0;
        this.scheduledLineageCompromised = false;
        this.lineageOwner = undefined;
    }

    private findScheduledLineage(event: MidiEvent): number {
        for (let index = this.scheduledLineageCount - 1; index >= 0; index--) {
            if (this.scheduledLineageEvent[index] === event) {
                return index;
            }
        }
        return -1;
    }

    private removeScheduledLineage(index: number): void {
        const last = --this.scheduledLineageCount;
        if (index !== last) {
            this.scheduledLineageEvent[index] = this.scheduledLineageEvent[last];
            this.scheduledLineageToken[index] = this.scheduledLineageToken[last]!;
            this.scheduledLineageDuration[index] = this.scheduledLineageDuration[last]!;
        }
        this.scheduledLineageEvent[last] = undefined;
    }

    protected resetParams(): void {
        this.repeatCount = 3;
        this.rate = { type: 'straight', denom: 16 };
        this.decay = 0.7;
        this.gate = 0.5;
        this.pitchStep = 0;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'repeat_count':
                this.repeatCount = Math.max(1, Math.min(16, Math.round(value)));
                break;
            case 'rate_denom':
                this.rate = { ...this.rate, denom: Math.max(1, value) };
                break;
            case 'decay':
                this.decay = Math.max(0, Math.min(1, value));
                break;
            case 'gate':
                this.gate = Math.max(0.01, Math.min(2, value));
                break;
            case 'pitch_step':
                this.pitchStep = Math.round(value);
                break;
        }
    }
}
