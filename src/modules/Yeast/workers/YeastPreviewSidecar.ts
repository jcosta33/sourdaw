import { YEAST_PREVIEW_CAPACITY } from '../models/YeastPreviewSnapshot';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastPreviewBlock, YeastPreviewEvent } from '../models/YeastPreviewSnapshot';

type MutableYeastPreviewEvent = {
    -readonly [Key in keyof YeastPreviewEvent]: YeastPreviewEvent[Key];
};

export type YeastPreviewDecisionSink = Pick<YeastPreviewSidecar, 'recordDecision'>;

function createPreviewRecord(): MutableYeastPreviewEvent {
    return {
        beatTime: 0,
        durationBeats: 0,
        pitch: 0,
        velocity: 0,
        probability: null,
        realized: true,
        processorId: '',
        bypassed: false,
        failed: false,
    };
}

/**
 * Worker-owned, fixed-capacity capture buffer.
 *
 * Pending Note Ons survive block boundaries. Completed records are exposed to
 * the Worker message boundary once per block; the scheduler's MIDI array is
 * never annotated or replaced with preview data.
 */
export class YeastPreviewSidecar {
    private readonly completed = Array.from({ length: YEAST_PREVIEW_CAPACITY }, createPreviewRecord);
    private readonly pendingBeatTime = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingPitch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingVelocity = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingChannel = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingSequence = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingBypassed = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingFailed = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly pendingProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private pendingCount = 0;
    private completedCount = 0;
    private droppedEvents = 0;
    private nextSequence = 0;
    private blockStartSamples = 0;
    private blockPpqPosition = 0;
    private samplesPerBeat = 0;
    private captureBlock = false;

    beginBlock(enabled: boolean, blockStartSamples: number, transport: TransportInfo): void {
        this.completedCount = 0;
        this.droppedEvents = 0;
        this.captureBlock = false;

        if (!enabled) {
            this.pendingCount = 0;
            return;
        }

        const samplesPerBeat = (transport.sampleRate * 60) / transport.bpm;
        if (!Number.isFinite(samplesPerBeat) || samplesPerBeat <= 0) {
            return;
        }

        this.blockStartSamples = blockStartSamples;
        this.blockPpqPosition = transport.ppqPosition;
        this.samplesPerBeat = samplesPerBeat;
        this.captureBlock = true;
    }

    recordEvents(
        events: readonly MidiEvent[],
        fallbackTrackId: string,
        processorId: string,
        bypassed: boolean,
        failed: boolean
    ): void {
        if (!this.captureBlock) {
            return;
        }

        for (let index = 0; index < events.length; index++) {
            const event = events[index]!;
            if (event.kind.type === 'noteOn') {
                this.recordNoteOn(
                    event.timeSamples,
                    event.trackId ?? fallbackTrackId,
                    event.kind.channel,
                    event.kind.note,
                    event.kind.velocity,
                    processorId,
                    bypassed,
                    failed
                );
            } else if (event.kind.type === 'noteOff') {
                this.recordNoteOff(
                    event.timeSamples,
                    event.trackId ?? fallbackTrackId,
                    event.kind.channel,
                    event.kind.note,
                    processorId
                );
            }
        }
    }

    /** Called by processors that own a probability/realization decision. */
    recordDecision(
        timeSamples: number,
        durationSamples: number,
        pitch: number,
        velocity: number,
        probability: number | null,
        realized: boolean,
        processorId: string
    ): void {
        if (!this.captureBlock) {
            return;
        }
        if (this.pendingCount + this.completedCount === YEAST_PREVIEW_CAPACITY) {
            this.droppedEvents += 1;
            return;
        }

        const slot = this.completed[this.completedCount++]!;
        slot.beatTime = this.toBeatTime(timeSamples);
        slot.durationBeats = Math.max(0, durationSamples / this.samplesPerBeat);
        slot.pitch = pitch;
        slot.velocity = velocity;
        slot.probability = probability;
        slot.realized = realized;
        slot.processorId = processorId;
        slot.bypassed = false;
        slot.failed = false;
    }

    takeBlock(): YeastPreviewBlock {
        const block = {
            records: this.completed.slice(0, this.completedCount),
            droppedEvents: this.droppedEvents,
        } satisfies YeastPreviewBlock;
        this.completedCount = 0;
        this.droppedEvents = 0;
        return block;
    }

    private recordNoteOn(
        timeSamples: number,
        trackId: string,
        channel: number,
        pitch: number,
        velocity: number,
        processorId: string,
        bypassed: boolean,
        failed: boolean
    ): void {
        if (this.pendingCount + this.completedCount === YEAST_PREVIEW_CAPACITY) {
            this.droppedEvents += 1;
            return;
        }

        const slot = this.pendingCount++;
        this.pendingBeatTime[slot] = this.toBeatTime(timeSamples);
        this.pendingPitch[slot] = pitch;
        this.pendingVelocity[slot] = velocity;
        this.pendingChannel[slot] = channel;
        this.pendingSequence[slot] = this.nextSequence++;
        this.pendingProbability[slot] = 0;
        this.pendingHasProbability[slot] = 0;
        this.pendingBypassed[slot] = bypassed ? 1 : 0;
        this.pendingFailed[slot] = failed ? 1 : 0;
        this.pendingTrackId[slot] = trackId;
        this.pendingProcessorId[slot] = processorId;
    }

    private recordNoteOff(
        timeSamples: number,
        trackId: string,
        channel: number,
        pitch: number,
        processorId: string
    ): void {
        let match = -1;
        let matchSequence = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.pendingCount; index++) {
            if (
                this.pendingPitch[index] === pitch &&
                this.pendingChannel[index] === channel &&
                this.pendingTrackId[index] === trackId &&
                this.pendingProcessorId[index] === processorId &&
                this.pendingSequence[index]! < matchSequence
            ) {
                match = index;
                matchSequence = this.pendingSequence[index]!;
            }
        }
        if (match === -1) {
            return;
        }

        const slot = this.completed[this.completedCount++]!;
        const noteOffBeatTime = this.toBeatTime(timeSamples);
        slot.beatTime = this.pendingBeatTime[match]!;
        slot.durationBeats = Math.max(0, noteOffBeatTime - slot.beatTime);
        slot.pitch = this.pendingPitch[match]!;
        slot.velocity = this.pendingVelocity[match]!;
        slot.probability = this.pendingHasProbability[match] ? this.pendingProbability[match]! : null;
        slot.realized = true;
        slot.processorId = this.pendingProcessorId[match]!;
        slot.bypassed = this.pendingBypassed[match] === 1;
        slot.failed = this.pendingFailed[match] === 1;
        this.removePending(match);
    }

    private removePending(index: number): void {
        const last = --this.pendingCount;
        if (index === last) {
            return;
        }
        this.pendingBeatTime[index] = this.pendingBeatTime[last]!;
        this.pendingPitch[index] = this.pendingPitch[last]!;
        this.pendingVelocity[index] = this.pendingVelocity[last]!;
        this.pendingChannel[index] = this.pendingChannel[last]!;
        this.pendingSequence[index] = this.pendingSequence[last]!;
        this.pendingProbability[index] = this.pendingProbability[last]!;
        this.pendingHasProbability[index] = this.pendingHasProbability[last]!;
        this.pendingBypassed[index] = this.pendingBypassed[last]!;
        this.pendingFailed[index] = this.pendingFailed[last]!;
        this.pendingTrackId[index] = this.pendingTrackId[last]!;
        this.pendingProcessorId[index] = this.pendingProcessorId[last]!;
    }

    private toBeatTime(timeSamples: number): number {
        return this.blockPpqPosition + (timeSamples - this.blockStartSamples) / this.samplesPerBeat;
    }
}
