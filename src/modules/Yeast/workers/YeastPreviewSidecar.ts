import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    YEAST_PREVIEW_CAPACITY,
    YEAST_PREVIEW_CLOSED_PHASE,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_OPEN_PHASE,
    YEAST_PREVIEW_REALIZED_FLAG,
} from '../models/YeastPreviewSnapshot';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastPreviewPackedPage } from '../models/YeastPreviewSnapshot';

export type YeastPreviewDecisionSink = Pick<YeastPreviewSidecar, 'recordDecision'>;

function createPreviewPage(): YeastPreviewPackedPage {
    return {
        rackId: '',
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
        rackIds: Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => ''),
        routeIds: Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => ''),
        trackIds: Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => ''),
        processorId: Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => ''),
        provenanceEventCount: new Uint16Array(YEAST_PREVIEW_CAPACITY),
        provenanceFlags: new Uint8Array(YEAST_PREVIEW_CAPACITY),
        provenanceProcessorId: Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => ''),
    };
}

/** Worker-owned, fixed-capacity capture of the terminal rack stream. */
export class YeastPreviewSidecar {
    private readonly page = createPreviewPage();
    private readonly pendingEventId = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingBeatTime = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingPitch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingVelocity = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingChannel = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingSequence = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingDurationBeats = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingFlags = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingRackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly pendingRouteId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly pendingTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly pendingProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');

    private readonly routeRackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routeId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routeTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routePreviousBlockStart = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routePreviousBlockEnd = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routePreviousPpq = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routePreviousSamplesPerBeat = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeHasPreviousBlock = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeProjectionVersion = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeDeferredDrops = new Float64Array(YEAST_PREVIEW_CAPACITY);

    private readonly decisionTimeSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionDurationSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionPitch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionVelocity = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionConsumed = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly decisionProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');

    private readonly originEvents: Array<MidiEvent | undefined> = Array.from(
        { length: YEAST_PREVIEW_CAPACITY },
        () => undefined
    );
    private readonly originFlags = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly originProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');

    private pendingCount = 0;
    private routeCount = 0;
    private decisionCount = 0;
    private originCount = 0;
    private nextSequence = 0;
    private nextEventId = 0;
    private blockStartSamples = 0;
    private blockPpqPosition = 0;
    private samplesPerBeat = 0;
    private currentRouteIndex = -1;
    private currentRackId = '';
    private currentRouteId = '';
    private currentTrackId = '';
    private captureRequested = false;
    private captureBlock = false;
    private pageBusy = false;

    constructor() {
        this.routeProjectionVersion.fill(-1);
    }

    beginBlock(
        enabled: boolean,
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo,
        rackId: string,
        routeId: string,
        trackId: string,
        projectionVersion: number
    ): void {
        this.captureRequested = false;
        this.captureBlock = false;
        this.decisionCount = 0;
        this.originCount = 0;
        this.currentRackId = rackId;
        this.currentRouteId = routeId;
        this.currentTrackId = trackId;
        const existingRoute = this.findRoute(rackId, routeId);

        if (!enabled) {
            this.invalidateRoutePending(rackId, routeId);
            if (existingRoute !== -1) {
                this.routeHasPreviousBlock[existingRoute] = 0;
            }
            return;
        }

        const samplesPerBeat = (transport.sampleRate * 60) / transport.bpm;
        const routeIndex = existingRoute === -1 ? this.createRoute(rackId, routeId, trackId) : existingRoute;
        if (
            routeIndex === -1 ||
            !Number.isFinite(samplesPerBeat) ||
            samplesPerBeat <= 0 ||
            blockEndSamples < blockStartSamples
        ) {
            this.invalidateRoutePending(rackId, routeId);
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
                this.invalidateRoutePending(rackId, routeId);
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

        this.page.rackId = rackId;
        this.page.routeId = routeId;
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

    recordProcessorEvents(events: readonly MidiEvent[], processorId: string, bypassed: boolean, failed: boolean): void {
        if (!this.captureRequested) {
            return;
        }
        this.originCount = 0;
        const flags = (bypassed ? YEAST_PREVIEW_BYPASSED_FLAG : 0) | (failed ? YEAST_PREVIEW_FAILED_FLAG : 0);
        for (let index = 0; index < events.length; index++) {
            const event = events[index]!;
            if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
                continue;
            }
            if (this.originCount === YEAST_PREVIEW_CAPACITY) {
                this.recordDrop();
                continue;
            }
            const slot = this.originCount++;
            this.originEvents[slot] = event;
            this.originProcessorId[slot] = processorId;
            this.originFlags[slot] = flags;
        }
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
                this.recordNoteOn(event, trackId);
            } else if (event.kind.type === 'noteOff') {
                if (!this.captureBlock) {
                    this.dropPendingNoteOff(trackId, event.kind.channel, event.kind.note);
                    continue;
                }
                this.recordNoteOff(event.timeSamples, trackId, event.kind.channel, event.kind.note);
            }
        }
    }

    recordDecision(
        timeSamples: number,
        durationSamples: number,
        pitch: number,
        velocity: number,
        probability: number | null,
        realized: boolean,
        processorId: string,
        trackId = this.currentTrackId
    ): void {
        if (!this.captureRequested) {
            return;
        }
        if (!realized) {
            if (!this.captureBlock || this.page.count === YEAST_PREVIEW_CAPACITY) {
                this.recordDrop();
                return;
            }
            const routeIndex = this.findRouteForTrack(trackId);
            const slot = this.page.count++;
            this.writeEvent(
                slot,
                this.nextEventId++,
                YEAST_PREVIEW_CLOSED_PHASE,
                this.toBeatTime(timeSamples),
                Math.max(0, durationSamples / this.samplesPerBeat),
                pitch,
                velocity,
                probability,
                false,
                processorId,
                0,
                routeIndex,
                trackId
            );
            return;
        }
        if (this.decisionCount === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
            return;
        }
        const slot = this.decisionCount++;
        this.decisionTimeSamples[slot] = timeSamples;
        this.decisionDurationSamples[slot] = durationSamples;
        this.decisionPitch[slot] = pitch;
        this.decisionVelocity[slot] = velocity;
        this.decisionProbability[slot] = probability ?? 0;
        this.decisionHasProbability[slot] = probability === null ? 0 : 1;
        this.decisionConsumed[slot] = 0;
        this.decisionTrackId[slot] = trackId;
        this.decisionProcessorId[slot] = processorId;
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

    private recordNoteOn(event: MidiEvent, trackId: string): void {
        if (event.kind.type !== 'noteOn') {
            return;
        }
        if (this.pendingCount === YEAST_PREVIEW_CAPACITY || this.page.count === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
            return;
        }

        const eventId = this.nextEventId++;
        const beatTime = this.toBeatTime(event.timeSamples);
        const decision = this.findDecision(event.timeSamples, event.kind.note, trackId);
        const origin = this.findOrigin(event);
        const probability =
            decision === -1 || this.decisionHasProbability[decision] === 0 ? null : this.decisionProbability[decision]!;
        const durationBeats =
            decision === -1 ? 0 : Math.max(0, this.decisionDurationSamples[decision]! / this.samplesPerBeat);
        let processorId = '';
        if (decision !== -1) {
            processorId = this.decisionProcessorId[decision]!;
        } else if (origin !== -1) {
            processorId = this.originProcessorId[origin]!;
        }
        const flags = decision === -1 && origin !== -1 ? this.originFlags[origin]! : 0;
        const routeIndex = this.findRouteForTrack(trackId);
        const rackId = routeIndex === -1 ? this.currentRackId : this.routeRackId[routeIndex]!;
        let routeId = trackId;
        if (routeIndex !== -1) {
            routeId = this.routeId[routeIndex]!;
        } else if (trackId === this.currentTrackId) {
            routeId = this.currentRouteId;
        }

        const pendingSlot = this.pendingCount++;
        this.pendingEventId[pendingSlot] = eventId;
        this.pendingBeatTime[pendingSlot] = beatTime;
        this.pendingPitch[pendingSlot] = event.kind.note;
        this.pendingVelocity[pendingSlot] = event.kind.velocity;
        this.pendingChannel[pendingSlot] = event.kind.channel;
        this.pendingSequence[pendingSlot] = this.nextSequence++;
        this.pendingProbability[pendingSlot] = probability ?? 0;
        this.pendingHasProbability[pendingSlot] = probability === null ? 0 : 1;
        this.pendingDurationBeats[pendingSlot] = durationBeats;
        this.pendingFlags[pendingSlot] = flags;
        this.pendingRackId[pendingSlot] = rackId;
        this.pendingRouteId[pendingSlot] = routeId;
        this.pendingTrackId[pendingSlot] = trackId;
        this.pendingProcessorId[pendingSlot] = processorId;

        const pageSlot = this.page.count++;
        this.writeEvent(
            pageSlot,
            eventId,
            YEAST_PREVIEW_OPEN_PHASE,
            beatTime,
            durationBeats,
            event.kind.note,
            event.kind.velocity,
            probability,
            true,
            processorId,
            flags,
            routeIndex,
            trackId
        );
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
        this.page.eventId[slot] = this.pendingEventId[match]!;
        this.page.phase[slot] = YEAST_PREVIEW_CLOSED_PHASE;
        this.page.beatTime[slot] = beatTime;
        this.page.durationBeats[slot] = Math.max(0, this.toBeatTime(timeSamples) - beatTime);
        this.page.pitch[slot] = this.pendingPitch[match]!;
        this.page.velocity[slot] = this.pendingVelocity[match]!;
        this.page.probability[slot] =
            this.pendingHasProbability[match] === 1 ? this.pendingProbability[match]! : Number.NaN;
        this.page.flags[slot] = YEAST_PREVIEW_REALIZED_FLAG | this.pendingFlags[match]!;
        this.page.rackIds[slot] = this.pendingRackId[match]!;
        this.page.routeIds[slot] = this.pendingRouteId[match]!;
        this.page.trackIds[slot] = this.pendingTrackId[match]!;
        this.page.processorId[slot] = this.pendingProcessorId[match]!;
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

    private findDecision(timeSamples: number, pitch: number, trackId: string): number {
        for (let index = this.decisionCount - 1; index >= 0; index--) {
            if (
                this.decisionConsumed[index] === 0 &&
                this.decisionTimeSamples[index] === timeSamples &&
                this.decisionPitch[index] === pitch &&
                this.decisionTrackId[index] === trackId
            ) {
                this.decisionConsumed[index] = 1;
                return index;
            }
        }
        return -1;
    }

    private findOrigin(event: MidiEvent): number {
        for (let index = this.originCount - 1; index >= 0; index--) {
            if (this.originEvents[index] === event) {
                return index;
            }
        }
        return -1;
    }

    private findRoute(rackId: string, routeId: string): number {
        for (let index = 0; index < this.routeCount; index++) {
            if (this.routeRackId[index] === rackId && this.routeId[index] === routeId) {
                return index;
            }
        }
        return -1;
    }

    private findRouteForTrack(trackId: string): number {
        if (trackId === this.currentTrackId) {
            return this.currentRouteIndex;
        }
        for (let index = this.routeCount - 1; index >= 0; index--) {
            if (this.routeTrackId[index] === trackId) {
                return index;
            }
        }
        return -1;
    }

    private createRoute(rackId: string, routeId: string, trackId: string): number {
        if (this.routeCount === YEAST_PREVIEW_CAPACITY) {
            return -1;
        }
        const index = this.routeCount++;
        this.routeRackId[index] = rackId;
        this.routeId[index] = routeId;
        this.routeTrackId[index] = trackId;
        return index;
    }

    private invalidateRoutePending(rackId: string, routeId: string): void {
        let index = 0;
        while (index < this.pendingCount) {
            if (this.pendingRackId[index] === rackId && this.pendingRouteId[index] === routeId) {
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
        this.pendingDurationBeats[index] = this.pendingDurationBeats[last]!;
        this.pendingFlags[index] = this.pendingFlags[last]!;
        this.pendingRackId[index] = this.pendingRackId[last]!;
        this.pendingRouteId[index] = this.pendingRouteId[last]!;
        this.pendingTrackId[index] = this.pendingTrackId[last]!;
        this.pendingProcessorId[index] = this.pendingProcessorId[last]!;
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
        probability: number | null,
        realized: boolean,
        processorId: string,
        provenanceFlags: number,
        routeIndex: number,
        trackId: string
    ): void {
        this.page.eventId[slot] = eventId;
        this.page.phase[slot] = phase;
        this.page.beatTime[slot] = beatTime;
        this.page.durationBeats[slot] = durationBeats;
        this.page.pitch[slot] = pitch;
        this.page.velocity[slot] = velocity;
        this.page.probability[slot] = probability ?? Number.NaN;
        this.page.flags[slot] = (realized ? YEAST_PREVIEW_REALIZED_FLAG : 0) | provenanceFlags;
        this.page.rackIds[slot] = routeIndex === -1 ? this.currentRackId : this.routeRackId[routeIndex]!;
        let routeId = trackId;
        if (routeIndex !== -1) {
            routeId = this.routeId[routeIndex]!;
        } else if (trackId === this.currentTrackId) {
            routeId = this.currentRouteId;
        }
        this.page.routeIds[slot] = routeId;
        this.page.trackIds[slot] = trackId;
        this.page.processorId[slot] = processorId;
    }

    private recordDrop(): void {
        if (this.captureBlock) {
            this.page.droppedEvents += 1;
        } else if (this.currentRouteIndex !== -1) {
            this.routeDeferredDrops[this.currentRouteIndex] = this.routeDeferredDrops[this.currentRouteIndex]! + 1;
        }
    }
}
