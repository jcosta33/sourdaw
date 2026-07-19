import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    YEAST_PREVIEW_CAPACITY,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_REALIZED_FLAG,
} from '../models/YeastPreviewSnapshot';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastPreviewPackedPage } from '../models/YeastPreviewSnapshot';

export type YeastPreviewDecisionSink = Pick<YeastPreviewSidecar, 'recordDecision'>;

function createPreviewPage(): YeastPreviewPackedPage {
    return {
        count: 0,
        droppedEvents: 0,
        beatTime: new Float64Array(YEAST_PREVIEW_CAPACITY),
        durationBeats: new Float64Array(YEAST_PREVIEW_CAPACITY),
        pitch: new Uint8Array(YEAST_PREVIEW_CAPACITY),
        velocity: new Float64Array(YEAST_PREVIEW_CAPACITY),
        probability: new Float64Array(YEAST_PREVIEW_CAPACITY),
        flags: new Uint8Array(YEAST_PREVIEW_CAPACITY),
        processorId: Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => ''),
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
    private readonly page = createPreviewPage();
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
    private nextSequence = 0;
    private blockStartSamples = 0;
    private blockPpqPosition = 0;
    private samplesPerBeat = 0;
    private previousBlockStartSamples = 0;
    private previousBlockEndSamples = 0;
    private previousBlockPpqPosition = 0;
    private previousSamplesPerBeat = 0;
    private hasPreviousBlock = false;
    private captureRequested = false;
    private captureBlock = false;
    private pageBusy = false;

    beginBlock(enabled: boolean, blockStartSamples: number, blockEndSamples: number, transport: TransportInfo): void {
        this.captureRequested = false;
        this.captureBlock = false;

        if (!enabled) {
            this.invalidatePending();
            this.hasPreviousBlock = false;
            return;
        }

        const samplesPerBeat = (transport.sampleRate * 60) / transport.bpm;
        if (!Number.isFinite(samplesPerBeat) || samplesPerBeat <= 0 || blockEndSamples < blockStartSamples) {
            this.invalidatePending();
            this.hasPreviousBlock = false;
            return;
        }

        if (this.hasPreviousBlock) {
            const expectedPpqPosition =
                this.previousBlockPpqPosition +
                (this.previousBlockEndSamples - this.previousBlockStartSamples) / this.previousSamplesPerBeat;
            const samplePositionChanged = blockStartSamples !== this.previousBlockEndSamples;
            const musicalPositionChanged = Math.abs(transport.ppqPosition - expectedPpqPosition) > 1e-6;
            if (samplePositionChanged || musicalPositionChanged) {
                this.invalidatePending();
            }
        }

        this.blockStartSamples = blockStartSamples;
        this.blockPpqPosition = transport.ppqPosition;
        this.samplesPerBeat = samplesPerBeat;
        this.previousBlockStartSamples = blockStartSamples;
        this.previousBlockEndSamples = blockEndSamples;
        this.previousBlockPpqPosition = transport.ppqPosition;
        this.previousSamplesPerBeat = samplesPerBeat;
        this.hasPreviousBlock = true;
        this.captureRequested = true;
        if (this.pageBusy) {
            return;
        }
        this.page.count = 0;
        this.page.droppedEvents = 0;
        this.captureBlock = true;
    }

    invalidatePending(): void {
        this.pendingCount = 0;
    }

    invalidateProcessorPending(processorId: string): void {
        let index = 0;
        while (index < this.pendingCount) {
            if (this.pendingProcessorId[index] === processorId) {
                this.removePending(index);
            } else {
                index += 1;
            }
        }
    }

    recordEvents(
        events: readonly MidiEvent[],
        fallbackTrackId: string,
        processorId: string,
        bypassed: boolean,
        failed: boolean
    ): void {
        if (!this.captureRequested) {
            return;
        }

        for (let index = 0; index < events.length; index++) {
            const event = events[index]!;
            if (event.kind.type === 'noteOn') {
                if (!this.captureBlock) {
                    this.recordDrop();
                    continue;
                }
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
                if (!this.captureBlock) {
                    this.dropPendingNoteOff(
                        event.trackId ?? fallbackTrackId,
                        event.kind.channel,
                        event.kind.note,
                        processorId
                    );
                    continue;
                }
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
        if (!this.captureRequested) {
            return;
        }
        if (!this.captureBlock || this.pendingCount + this.page.count === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
            return;
        }

        const slot = this.page.count++;
        this.writeCompleted(
            slot,
            this.toBeatTime(timeSamples),
            Math.max(0, durationSamples / this.samplesPerBeat),
            pitch,
            velocity,
            probability,
            realized ? YEAST_PREVIEW_REALIZED_FLAG : 0,
            processorId
        );
    }

    takePage(): YeastPreviewPackedPage | undefined {
        const completedThisBlock = this.captureBlock;
        this.captureRequested = false;
        this.captureBlock = false;
        if (!completedThisBlock || this.pageBusy) {
            return undefined;
        }
        if (this.page.count === 0 && this.page.droppedEvents === 0) {
            return undefined;
        }
        this.pageBusy = true;
        return this.page;
    }

    releasePage(page: YeastPreviewPackedPage): void {
        if (page !== this.page || !this.pageBusy) {
            return;
        }
        this.pageBusy = false;
        this.page.count = 0;
        this.page.droppedEvents = 0;
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
        if (this.pendingCount + this.page.count === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
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
        const match = this.findPendingNote(trackId, channel, pitch, processorId);
        if (match === -1) {
            return;
        }

        const beatTime = this.pendingBeatTime[match]!;
        const flags =
            YEAST_PREVIEW_REALIZED_FLAG |
            (this.pendingBypassed[match] === 1 ? YEAST_PREVIEW_BYPASSED_FLAG : 0) |
            (this.pendingFailed[match] === 1 ? YEAST_PREVIEW_FAILED_FLAG : 0);
        const slot = this.page.count++;
        this.writeCompleted(
            slot,
            beatTime,
            Math.max(0, this.toBeatTime(timeSamples) - beatTime),
            this.pendingPitch[match]!,
            this.pendingVelocity[match]!,
            this.pendingHasProbability[match] ? this.pendingProbability[match]! : null,
            flags,
            this.pendingProcessorId[match]!
        );
        this.removePending(match);
    }

    private dropPendingNoteOff(trackId: string, channel: number, pitch: number, processorId: string): void {
        const match = this.findPendingNote(trackId, channel, pitch, processorId);
        if (match === -1) {
            return;
        }
        this.removePending(match);
        this.recordDrop();
    }

    private findPendingNote(trackId: string, channel: number, pitch: number, processorId: string): number {
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
        return match;
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

    private writeCompleted(
        slot: number,
        beatTime: number,
        durationBeats: number,
        pitch: number,
        velocity: number,
        probability: number | null,
        flags: number,
        processorId: string
    ): void {
        this.page.beatTime[slot] = beatTime;
        this.page.durationBeats[slot] = durationBeats;
        this.page.pitch[slot] = pitch;
        this.page.velocity[slot] = velocity;
        this.page.probability[slot] = probability ?? Number.NaN;
        this.page.flags[slot] = flags;
        this.page.processorId[slot] = processorId;
    }

    private recordDrop(): void {
        this.page.droppedEvents += 1;
    }
}
