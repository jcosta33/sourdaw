import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    YEAST_PREVIEW_CAPACITY,
    YEAST_PREVIEW_CLOSED_PHASE,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_OPEN_PHASE,
    YEAST_PREVIEW_RACK_ID,
    YEAST_PREVIEW_REALIZED_FLAG,
} from '../models/YeastPreviewSnapshot';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastPreviewPackedPage } from '../models/YeastPreviewSnapshot';

export type YeastPreviewDecisionSink = Pick<YeastPreviewSidecar, 'recordDecision'>;

function createPreviewPage(rackId: string): YeastPreviewPackedPage {
    return {
        rackId,
        routeId: '',
        trackId: '',
        projectionVersion: 0,
        reset: false,
        count: 0,
        provenanceCount: 0,
        droppedEvents: 0,
        eventId: new Float64Array(YEAST_PREVIEW_CAPACITY),
        phase: new Uint8Array(YEAST_PREVIEW_CAPACITY),
        beatTime: new Float64Array(YEAST_PREVIEW_CAPACITY),
        durationBeats: new Float64Array(YEAST_PREVIEW_CAPACITY),
        pitch: new Uint8Array(YEAST_PREVIEW_CAPACITY),
        velocity: new Float64Array(YEAST_PREVIEW_CAPACITY),
        probability: new Float64Array(YEAST_PREVIEW_CAPACITY),
        flags: new Uint8Array(YEAST_PREVIEW_CAPACITY),
        provenanceEventCount: new Uint16Array(YEAST_PREVIEW_CAPACITY),
        provenanceFlags: new Uint8Array(YEAST_PREVIEW_CAPACITY),
        provenanceProcessorId: Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => ''),
    };
}

/** Worker-owned, fixed-capacity capture of the terminal rack stream. */
export class YeastPreviewSidecar {
    private readonly page: YeastPreviewPackedPage;
    private readonly pendingEventId = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingBeatTime = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingPitch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingVelocity = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingChannel = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingSequence = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routeId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routePreviousBlockStart = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routePreviousBlockEnd = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routePreviousPpq = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routePreviousSamplesPerBeat = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeHasPreviousBlock = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeProjectionVersion = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeDeferredDrops = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionTimeSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionPitch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionRealized = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private pendingCount = 0;
    private routeCount = 0;
    private decisionCount = 0;
    private nextSequence = 0;
    private nextEventId = 0;
    private blockStartSamples = 0;
    private blockPpqPosition = 0;
    private samplesPerBeat = 0;
    private currentRouteIndex = -1;
    private captureRequested = false;
    private captureBlock = false;
    private pageBusy = false;

    constructor(rackId = YEAST_PREVIEW_RACK_ID) {
        this.page = createPreviewPage(rackId);
        this.routeProjectionVersion.fill(-1);
    }

    beginBlock(
        enabled: boolean,
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo,
        trackId: string,
        projectionVersion: number
    ): void {
        this.captureRequested = false;
        this.captureBlock = false;
        this.decisionCount = 0;
        const existingRoute = this.findRoute(trackId);

        if (!enabled) {
            this.invalidateRoutePending(trackId);
            if (existingRoute !== -1) {
                this.routeHasPreviousBlock[existingRoute] = 0;
            }
            return;
        }

        const samplesPerBeat = (transport.sampleRate * 60) / transport.bpm;
        const routeIndex = existingRoute === -1 ? this.createRoute(trackId) : existingRoute;
        if (
            routeIndex === -1 ||
            !Number.isFinite(samplesPerBeat) ||
            samplesPerBeat <= 0 ||
            blockEndSamples < blockStartSamples
        ) {
            this.invalidateRoutePending(trackId);
            if (routeIndex !== -1) {
                this.routeHasPreviousBlock[routeIndex] = 0;
            }
            return;
        }

        if (this.routeHasPreviousBlock[routeIndex] === 1) {
            const expectedPpqPosition =
                this.routePreviousPpq[routeIndex]! +
                (this.routePreviousBlockEnd[routeIndex]! - this.routePreviousBlockStart[routeIndex]!) /
                    this.routePreviousSamplesPerBeat[routeIndex]!;
            const samplePositionChanged = blockStartSamples !== this.routePreviousBlockEnd[routeIndex];
            const musicalPositionChanged = Math.abs(transport.ppqPosition - expectedPpqPosition) > 1e-6;
            if (samplePositionChanged || musicalPositionChanged) {
                this.invalidateRoutePending(trackId);
            }
        }

        this.blockStartSamples = blockStartSamples;
        this.blockPpqPosition = transport.ppqPosition;
        this.samplesPerBeat = samplesPerBeat;
        this.currentRouteIndex = routeIndex;
        this.routePreviousBlockStart[routeIndex] = blockStartSamples;
        this.routePreviousBlockEnd[routeIndex] = blockEndSamples;
        this.routePreviousPpq[routeIndex] = transport.ppqPosition;
        this.routePreviousSamplesPerBeat[routeIndex] = samplesPerBeat;
        this.routeHasPreviousBlock[routeIndex] = 1;
        this.captureRequested = true;
        if (this.pageBusy) {
            return;
        }

        this.page.routeId = trackId;
        this.page.trackId = trackId;
        this.page.projectionVersion = projectionVersion;
        this.page.reset = this.routeProjectionVersion[routeIndex] !== projectionVersion;
        this.routeProjectionVersion[routeIndex] = projectionVersion;
        this.page.count = 0;
        this.page.provenanceCount = 0;
        this.page.droppedEvents = this.routeDeferredDrops[routeIndex]!;
        this.routeDeferredDrops[routeIndex] = 0;
        this.captureBlock = true;
    }

    invalidatePending(): void {
        this.pendingCount = 0;
    }

    invalidateProcessorPending(_processorId: string): void {
        this.invalidatePending();
    }

    recordProcessorProvenance(processorId: string, bypassed: boolean, failed: boolean, eventCount: number): void {
        if (!this.captureRequested || !this.captureBlock) {
            return;
        }
        for (let index = 0; index < this.page.provenanceCount; index++) {
            if (this.page.provenanceProcessorId[index] === processorId) {
                this.page.provenanceEventCount[index] = Math.min(
                    65535,
                    this.page.provenanceEventCount[index]! + eventCount
                );
                this.page.provenanceFlags[index] =
                    this.page.provenanceFlags[index]! |
                    (bypassed ? YEAST_PREVIEW_BYPASSED_FLAG : 0) |
                    (failed ? YEAST_PREVIEW_FAILED_FLAG : 0);
                return;
            }
        }
        if (this.page.provenanceCount === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
            return;
        }
        const slot = this.page.provenanceCount++;
        this.page.provenanceProcessorId[slot] = processorId;
        this.page.provenanceEventCount[slot] = Math.min(65535, eventCount);
        this.page.provenanceFlags[slot] =
            (bypassed ? YEAST_PREVIEW_BYPASSED_FLAG : 0) | (failed ? YEAST_PREVIEW_FAILED_FLAG : 0);
    }

    recordTerminalEvents(events: readonly MidiEvent[], fallbackTrackId: string): void {
        if (!this.captureRequested) {
            return;
        }
        for (let index = 0; index < events.length; index++) {
            const event = events[index]!;
            const trackId = event.trackId ?? fallbackTrackId;
            if (event.kind.type === 'noteOn') {
                if (!this.captureBlock) {
                    this.recordDrop();
                    continue;
                }
                this.recordNoteOn(event.timeSamples, trackId, event.kind.channel, event.kind.note, event.kind.velocity);
            } else if (event.kind.type === 'noteOff') {
                if (!this.captureBlock) {
                    this.dropPendingNoteOff(trackId, event.kind.channel, event.kind.note);
                    continue;
                }
                this.recordNoteOff(event.timeSamples, trackId, event.kind.channel, event.kind.note);
            }
        }
    }

    /** Retains probability metadata for a matching terminal Note On only. */
    recordDecision(
        timeSamples: number,
        _durationSamples: number,
        pitch: number,
        _velocity: number,
        probability: number | null,
        realized: boolean,
        _processorId: string
    ): void {
        if (!this.captureRequested || this.decisionCount === YEAST_PREVIEW_CAPACITY) {
            return;
        }
        const slot = this.decisionCount++;
        this.decisionTimeSamples[slot] = timeSamples;
        this.decisionPitch[slot] = pitch;
        this.decisionProbability[slot] = probability ?? 0;
        this.decisionHasProbability[slot] = probability === null ? 0 : 1;
        this.decisionRealized[slot] = realized ? 1 : 0;
    }

    takePage(): YeastPreviewPackedPage | undefined {
        const completedThisBlock = this.captureBlock;
        this.captureRequested = false;
        this.captureBlock = false;
        if (!completedThisBlock || this.pageBusy) {
            return undefined;
        }
        if (
            this.page.count === 0 &&
            this.page.provenanceCount === 0 &&
            this.page.droppedEvents === 0 &&
            !this.page.reset
        ) {
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
        this.page.provenanceCount = 0;
        this.page.droppedEvents = 0;
        this.page.reset = false;
    }

    private recordNoteOn(timeSamples: number, trackId: string, channel: number, pitch: number, velocity: number): void {
        if (this.pendingCount === YEAST_PREVIEW_CAPACITY || this.page.count === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
            return;
        }

        const eventId = this.nextEventId++;
        const beatTime = this.toBeatTime(timeSamples);
        const decision = this.findDecision(timeSamples, pitch);
        const probability =
            decision === -1 || this.decisionHasProbability[decision] === 0 ? null : this.decisionProbability[decision]!;
        const pendingSlot = this.pendingCount++;
        this.pendingEventId[pendingSlot] = eventId;
        this.pendingBeatTime[pendingSlot] = beatTime;
        this.pendingPitch[pendingSlot] = pitch;
        this.pendingVelocity[pendingSlot] = velocity;
        this.pendingChannel[pendingSlot] = channel;
        this.pendingSequence[pendingSlot] = this.nextSequence++;
        this.pendingProbability[pendingSlot] = probability ?? 0;
        this.pendingHasProbability[pendingSlot] = probability === null ? 0 : 1;
        this.pendingTrackId[pendingSlot] = trackId;

        const pageSlot = this.page.count++;
        this.writeEvent(pageSlot, eventId, YEAST_PREVIEW_OPEN_PHASE, beatTime, 0, pitch, velocity, probability);
    }

    private recordNoteOff(timeSamples: number, trackId: string, channel: number, pitch: number): void {
        const match = this.findPendingNote(trackId, channel, pitch);
        if (match === -1) {
            return;
        }
        if (this.page.count === YEAST_PREVIEW_CAPACITY) {
            this.removePending(match);
            this.recordDrop();
            return;
        }

        const beatTime = this.pendingBeatTime[match]!;
        const slot = this.page.count++;
        this.writeEvent(
            slot,
            this.pendingEventId[match]!,
            YEAST_PREVIEW_CLOSED_PHASE,
            beatTime,
            Math.max(0, this.toBeatTime(timeSamples) - beatTime),
            this.pendingPitch[match]!,
            this.pendingVelocity[match]!,
            this.pendingHasProbability[match] === 1 ? this.pendingProbability[match]! : null
        );
        this.removePending(match);
    }

    private dropPendingNoteOff(trackId: string, channel: number, pitch: number): void {
        const match = this.findPendingNote(trackId, channel, pitch);
        if (match === -1) {
            return;
        }
        this.removePending(match);
        this.recordDrop();
    }

    private findPendingNote(trackId: string, channel: number, pitch: number): number {
        let match = -1;
        let matchSequence = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.pendingCount; index++) {
            if (
                this.pendingPitch[index] === pitch &&
                this.pendingChannel[index] === channel &&
                this.pendingTrackId[index] === trackId &&
                this.pendingSequence[index]! < matchSequence
            ) {
                match = index;
                matchSequence = this.pendingSequence[index]!;
            }
        }
        return match;
    }

    private findDecision(timeSamples: number, pitch: number): number {
        for (let index = this.decisionCount - 1; index >= 0; index--) {
            if (
                this.decisionRealized[index] === 1 &&
                this.decisionTimeSamples[index] === timeSamples &&
                this.decisionPitch[index] === pitch
            ) {
                return index;
            }
        }
        return -1;
    }

    private findRoute(routeId: string): number {
        for (let index = 0; index < this.routeCount; index++) {
            if (this.routeId[index] === routeId) {
                return index;
            }
        }
        return -1;
    }

    private createRoute(routeId: string): number {
        if (this.routeCount === YEAST_PREVIEW_CAPACITY) {
            return -1;
        }
        const index = this.routeCount++;
        this.routeId[index] = routeId;
        return index;
    }

    private invalidateRoutePending(trackId: string): void {
        let index = 0;
        while (index < this.pendingCount) {
            if (this.pendingTrackId[index] === trackId) {
                this.removePending(index);
            } else {
                index += 1;
            }
        }
    }

    private removePending(index: number): void {
        const last = --this.pendingCount;
        if (index === last) {
            return;
        }
        this.pendingEventId[index] = this.pendingEventId[last]!;
        this.pendingBeatTime[index] = this.pendingBeatTime[last]!;
        this.pendingPitch[index] = this.pendingPitch[last]!;
        this.pendingVelocity[index] = this.pendingVelocity[last]!;
        this.pendingChannel[index] = this.pendingChannel[last]!;
        this.pendingSequence[index] = this.pendingSequence[last]!;
        this.pendingProbability[index] = this.pendingProbability[last]!;
        this.pendingHasProbability[index] = this.pendingHasProbability[last]!;
        this.pendingTrackId[index] = this.pendingTrackId[last]!;
    }

    private toBeatTime(timeSamples: number): number {
        return this.blockPpqPosition + (timeSamples - this.blockStartSamples) / this.samplesPerBeat;
    }

    private writeEvent(
        slot: number,
        eventId: number,
        phase: number,
        beatTime: number,
        durationBeats: number,
        pitch: number,
        velocity: number,
        probability: number | null
    ): void {
        this.page.eventId[slot] = eventId;
        this.page.phase[slot] = phase;
        this.page.beatTime[slot] = beatTime;
        this.page.durationBeats[slot] = durationBeats;
        this.page.pitch[slot] = pitch;
        this.page.velocity[slot] = velocity;
        this.page.probability[slot] = probability ?? Number.NaN;
        this.page.flags[slot] = YEAST_PREVIEW_REALIZED_FLAG;
    }

    private recordDrop(): void {
        if (this.captureBlock) {
            this.page.droppedEvents += 1;
        } else if (this.currentRouteIndex !== -1) {
            this.routeDeferredDrops[this.currentRouteIndex] = this.routeDeferredDrops[this.currentRouteIndex]! + 1;
        }
    }
}
