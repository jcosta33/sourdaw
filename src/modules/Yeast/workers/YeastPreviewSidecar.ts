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

export type YeastPreviewDecisionLineage = number;

export type YeastPreviewDecisionSink = Pick<
    YeastPreviewSidecar,
    | 'recordDecision'
    | 'transferDecisionLineage'
    | 'retainDecisionLineage'
    | 'restoreDecisionLineage'
    | 'releaseDecisionLineage'
>;

const LOST_DECISION = -2;
const LOST_LINEAGE_TOKEN = -1;

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
    private readonly pendingCaptureEpoch = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingRackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly pendingRouteId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly pendingTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly pendingProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');

    private readonly routeRackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routeId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routeTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly routeCaptureEpoch = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeActive = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeLastUsed = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeDiscontinuityEpoch = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeHasDiscontinuityEpoch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeProjectionVersion = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeDeferredDrops = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly routeResetPending = new Uint8Array(YEAST_PREVIEW_CAPACITY);

    private readonly decisionTimeSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionDurationSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionPitch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionVelocity = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionRealized = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionSequence = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly decisionTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly decisionProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly unrealizedOrder = new Int32Array(YEAST_PREVIEW_CAPACITY);

    private readonly lineageEventA: Array<MidiEvent | undefined> = Array.from(
        { length: YEAST_PREVIEW_CAPACITY },
        () => undefined
    );
    private readonly lineageEventB: Array<MidiEvent | undefined> = Array.from(
        { length: YEAST_PREVIEW_CAPACITY },
        () => undefined
    );
    private readonly lineageDecisionA = new Int32Array(YEAST_PREVIEW_CAPACITY);
    private readonly lineageDecisionB = new Int32Array(YEAST_PREVIEW_CAPACITY);

    private readonly retainedActive = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedGeneration = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedReferences = new Uint16Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedDurationSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedRackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedRouteId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedCaptureEpoch = new Float64Array(YEAST_PREVIEW_CAPACITY);

    private readonly retainedCheckpointSlot = new Int32Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedCheckpointActive = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedCheckpointGeneration = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedCheckpointReferences = new Uint16Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedCheckpointDurationSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedCheckpointProbability = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedCheckpointHasProbability = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly retainedCheckpointProcessorId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedCheckpointRackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedCheckpointRouteId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedCheckpointTrackId = Array.from({ length: YEAST_PREVIEW_CAPACITY }, () => '');
    private readonly retainedCheckpointCaptureEpoch = new Float64Array(YEAST_PREVIEW_CAPACITY);

    private readonly queuedPreviewEvent: Array<MidiEvent | undefined> = Array.from(
        { length: YEAST_PREVIEW_CAPACITY },
        () => undefined
    );

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
    private nextDecisionSequence = 0;
    private nextEventId = 0;
    private nextRouteUseSequence = 0;
    private nextRetainedGeneration = 1;
    private blockStartSamples = 0;
    private blockEndSamples = 0;
    private blockPpqPosition = 0;
    private samplesPerBeat = 0;
    private currentRouteIndex = -1;
    private currentRackId = '';
    private currentRouteId = '';
    private currentTrackId = '';
    private captureRequested = false;
    private captureBlock = false;
    private pageBusy = false;
    private lineageUsesA = true;
    private lineageCount = 0;
    private nextLineageCount = 0;
    private processorTransformationActive = false;
    private lineageCompromised = false;
    private queuedPreviewCount = 0;
    private retainedCheckpointCount = 0;
    private processorCheckpointDecisionCount = 0;
    private processorCheckpointNextDecisionSequence = 0;
    private processorCheckpointNextRetainedGeneration = 0;
    private processorCheckpointPageDroppedEvents = 0;
    private processorCheckpointDeferredDrops = 0;
    private processorCheckpointRouteIndex = -1;
    private processorCheckpointLineageCompromised = false;

    constructor() {
        this.routeProjectionVersion.fill(-1);
        this.routeCaptureEpoch.fill(-1);
    }

    beginBlock(
        enabled: boolean,
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo,
        rackId: string,
        routeId: string,
        trackId: string,
        captureEpoch: number,
        projectionVersion: number
    ): void {
        this.captureRequested = false;
        this.captureBlock = false;
        this.decisionCount = 0;
        this.originCount = 0;
        this.lineageUsesA = true;
        this.lineageCount = 0;
        this.nextLineageCount = 0;
        this.processorTransformationActive = false;
        this.lineageCompromised = false;
        this.currentRackId = rackId;
        this.currentRouteId = routeId;
        this.currentTrackId = trackId;
        this.currentRouteIndex = -1;
        const existingRoute = this.findRoute(rackId, routeId);

        if (!enabled) {
            if (existingRoute !== -1) {
                this.retireRoute(existingRoute);
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
                this.routeResetPending[routeIndex] = 1;
            }
            return;
        }

        if (this.routeTrackId[routeIndex] !== trackId || this.routeCaptureEpoch[routeIndex] !== captureEpoch) {
            this.invalidateRoutePending(rackId, routeId);
            this.resetRouteMetadata(routeIndex);
            this.routeTrackId[routeIndex] = trackId;
            this.routeCaptureEpoch[routeIndex] = captureEpoch;
        }

        if (transport.discontinuityEpoch !== undefined) {
            if (
                this.routeHasDiscontinuityEpoch[routeIndex] === 1 &&
                this.routeDiscontinuityEpoch[routeIndex] !== transport.discontinuityEpoch
            ) {
                this.invalidateRoutePending(rackId, routeId);
                this.invalidateRouteRetained(rackId, routeId);
                this.routeResetPending[routeIndex] = 1;
            }
            this.routeDiscontinuityEpoch[routeIndex] = transport.discontinuityEpoch;
            this.routeHasDiscontinuityEpoch[routeIndex] = 1;
        }

        this.blockStartSamples = blockStartSamples;
        this.blockEndSamples = blockEndSamples;
        this.blockPpqPosition = transport.ppqPosition;
        this.samplesPerBeat = samplesPerBeat;
        this.currentRouteIndex = routeIndex;
        this.currentRackId = this.routeRackId[routeIndex]!;
        this.currentRouteId = this.routeId[routeIndex]!;
        this.currentTrackId = this.routeTrackId[routeIndex]!;
        this.routeLastUsed[routeIndex] = this.nextRouteUseSequence++;
        this.captureRequested = true;
        if (this.pageBusy) {
            return;
        }

        this.page.rackId = this.currentRackId;
        this.page.routeId = this.currentRouteId;
        this.page.trackId = this.currentTrackId;
        this.page.projectionVersion = projectionVersion;
        this.page.reset =
            this.routeProjectionVersion[routeIndex] !== projectionVersion || this.routeResetPending[routeIndex] === 1;
        this.routeResetPending[routeIndex] = 0;
        this.routeProjectionVersion[routeIndex] = projectionVersion;
        this.page.count = 0;
        this.page.provenanceCount = 0;
        this.page.droppedEvents = this.routeDeferredDrops[routeIndex]!;
        this.routeDeferredDrops[routeIndex] = 0;
        this.captureBlock = true;
    }

    invalidatePending(): void {
        this.pendingCount = 0;
        this.queuedPreviewCount = 0;
        this.clearRetainedLineage();
    }

    resetAll(): void {
        this.invalidatePending();
        for (let index = 0; index < this.routeCount; index++) {
            this.retireRoute(index);
        }
    }

    releaseRoute(rackId: string, routeId: string, trackId: string, captureEpoch: number): void {
        const routeIndex = this.findRoute(rackId, routeId);
        if (
            routeIndex !== -1 &&
            this.routeTrackId[routeIndex] === trackId &&
            this.routeCaptureEpoch[routeIndex] === captureEpoch
        ) {
            this.retireRoute(routeIndex);
        }
    }

    invalidateProcessorPending(_processorId: string): void {
        this.invalidatePending();
    }

    beginProcessorEvents(): void {
        if (this.captureRequested) {
            this.originCount = 0;
        }
    }

    beginProcessorTransformation(): void {
        if (!this.captureRequested) {
            return;
        }
        this.processorCheckpointDecisionCount = this.decisionCount;
        this.processorCheckpointNextDecisionSequence = this.nextDecisionSequence;
        this.processorCheckpointNextRetainedGeneration = this.nextRetainedGeneration;
        this.processorCheckpointPageDroppedEvents = this.page.droppedEvents;
        this.processorCheckpointRouteIndex = this.currentRouteIndex;
        this.processorCheckpointDeferredDrops =
            this.currentRouteIndex === -1 ? 0 : this.routeDeferredDrops[this.currentRouteIndex]!;
        this.processorCheckpointLineageCompromised = this.lineageCompromised;
        this.retainedCheckpointCount = 0;
        this.nextLineageCount = 0;
        this.processorTransformationActive = true;
    }

    transferDecisionLineage(source: MidiEvent, target: MidiEvent): void {
        if (!this.captureRequested || !this.processorTransformationActive) {
            return;
        }
        const decision = this.findLineageDecision(source);
        if (decision !== -1) {
            this.appendNextLineage(target, decision);
        }
    }

    retainDecisionLineage(source: MidiEvent, references = 1): YeastPreviewDecisionLineage | undefined {
        if (!this.captureRequested || !this.processorTransformationActive) {
            return undefined;
        }
        const decision = this.findLineageDecision(source);
        if (decision === -1) {
            return this.lineageCompromised ? LOST_LINEAGE_TOKEN : undefined;
        }
        if (decision === LOST_DECISION) {
            return LOST_LINEAGE_TOKEN;
        }
        if (references <= 0) {
            return LOST_LINEAGE_TOKEN;
        }
        for (let slot = 0; slot < YEAST_PREVIEW_CAPACITY; slot++) {
            if (this.retainedActive[slot] === 1) {
                continue;
            }
            this.checkpointRetainedSlot(slot);
            const generation = this.nextRetainedGeneration++;
            this.retainedActive[slot] = 1;
            this.retainedGeneration[slot] = generation;
            this.retainedReferences[slot] = Math.max(1, Math.min(65535, references));
            this.retainedDurationSamples[slot] = this.decisionDurationSamples[decision]!;
            this.retainedProbability[slot] = this.decisionProbability[decision]!;
            this.retainedHasProbability[slot] = this.decisionHasProbability[decision]!;
            this.retainedProcessorId[slot] = this.decisionProcessorId[decision]!;
            this.retainedRackId[slot] = this.currentRackId;
            this.retainedRouteId[slot] = this.currentRouteId;
            this.retainedTrackId[slot] = this.currentTrackId;
            this.retainedCaptureEpoch[slot] =
                this.currentRouteIndex === -1 ? -1 : this.routeCaptureEpoch[this.currentRouteIndex]!;
            return generation * YEAST_PREVIEW_CAPACITY + slot + 1;
        }
        return LOST_LINEAGE_TOKEN;
    }

    restoreDecisionLineage(lineage: YeastPreviewDecisionLineage, target: MidiEvent, durationSamples?: number): void {
        if (target.kind.type !== 'noteOn') {
            return;
        }
        if (lineage === LOST_LINEAGE_TOKEN) {
            this.appendNextLineage(target, LOST_DECISION);
            return;
        }
        const slot = (lineage - 1) % YEAST_PREVIEW_CAPACITY;
        const generation = Math.floor((lineage - 1) / YEAST_PREVIEW_CAPACITY);
        if (
            slot < 0 ||
            this.retainedActive[slot] !== 1 ||
            this.retainedGeneration[slot] !== generation ||
            !this.retainedLineageMatchesCurrentRoute(slot, target.trackId ?? this.currentTrackId)
        ) {
            this.releaseDecisionLineage(lineage);
            this.appendNextLineage(target, LOST_DECISION);
            return;
        }
        this.recordDecision(
            target.timeSamples,
            durationSamples ?? this.retainedDurationSamples[slot]!,
            target.kind.note,
            target.kind.velocity,
            this.retainedHasProbability[slot] === 0 ? null : this.retainedProbability[slot]!,
            true,
            this.retainedProcessorId[slot]!,
            target.trackId,
            target
        );
        this.releaseDecisionLineage(lineage);
    }

    releaseDecisionLineage(lineage: YeastPreviewDecisionLineage, references = 1): void {
        if (lineage <= 0) {
            return;
        }
        const slot = (lineage - 1) % YEAST_PREVIEW_CAPACITY;
        const generation = Math.floor((lineage - 1) / YEAST_PREVIEW_CAPACITY);
        if (this.retainedActive[slot] !== 1 || this.retainedGeneration[slot] !== generation) {
            return;
        }
        const remaining = Math.max(0, this.retainedReferences[slot]! - references);
        this.checkpointRetainedSlot(slot);
        this.retainedReferences[slot] = remaining;
        if (remaining === 0) {
            this.retainedActive[slot] = 0;
            this.retainedProcessorId[slot] = '';
            this.retainedRackId[slot] = '';
            this.retainedRouteId[slot] = '';
            this.retainedTrackId[slot] = '';
        }
    }

    private retainedLineageMatchesCurrentRoute(slot: number, trackId: string): boolean {
        const routeIndex = this.findRouteForTrack(trackId);
        return (
            routeIndex !== -1 &&
            this.retainedRackId[slot] === this.routeRackId[routeIndex] &&
            this.retainedRouteId[slot] === this.routeId[routeIndex] &&
            this.retainedTrackId[slot] === trackId &&
            this.retainedCaptureEpoch[slot] === this.routeCaptureEpoch[routeIndex]
        );
    }

    finishProcessorTransformation(output: readonly MidiEvent[]): void {
        if (!this.captureRequested || !this.processorTransformationActive) {
            return;
        }
        for (let index = 0; index < output.length; index++) {
            const event = output[index]!;
            if (this.findNextLineageDecision(event) !== -1) {
                continue;
            }
            const decision = this.findLineageDecision(event);
            if (decision !== -1) {
                this.appendNextLineage(event, decision);
            }
        }
        this.lineageUsesA = !this.lineageUsesA;
        this.lineageCount = this.nextLineageCount;
        this.nextLineageCount = 0;
        this.retainedCheckpointCount = 0;
        this.processorTransformationActive = false;
    }

    cancelProcessorTransformation(): void {
        if (!this.captureRequested || !this.processorTransformationActive) {
            return;
        }
        this.decisionCount = this.processorCheckpointDecisionCount;
        this.nextDecisionSequence = this.processorCheckpointNextDecisionSequence;
        this.nextRetainedGeneration = this.processorCheckpointNextRetainedGeneration;
        this.page.droppedEvents = this.processorCheckpointPageDroppedEvents;
        if (this.processorCheckpointRouteIndex !== -1) {
            this.routeDeferredDrops[this.processorCheckpointRouteIndex] = this.processorCheckpointDeferredDrops;
        }
        this.lineageCompromised = this.processorCheckpointLineageCompromised;
        for (let checkpoint = this.retainedCheckpointCount - 1; checkpoint >= 0; checkpoint--) {
            const slot = this.retainedCheckpointSlot[checkpoint]!;
            this.retainedActive[slot] = this.retainedCheckpointActive[checkpoint]!;
            this.retainedGeneration[slot] = this.retainedCheckpointGeneration[checkpoint]!;
            this.retainedReferences[slot] = this.retainedCheckpointReferences[checkpoint]!;
            this.retainedDurationSamples[slot] = this.retainedCheckpointDurationSamples[checkpoint]!;
            this.retainedProbability[slot] = this.retainedCheckpointProbability[checkpoint]!;
            this.retainedHasProbability[slot] = this.retainedCheckpointHasProbability[checkpoint]!;
            this.retainedProcessorId[slot] = this.retainedCheckpointProcessorId[checkpoint]!;
            this.retainedRackId[slot] = this.retainedCheckpointRackId[checkpoint]!;
            this.retainedRouteId[slot] = this.retainedCheckpointRouteId[checkpoint]!;
            this.retainedTrackId[slot] = this.retainedCheckpointTrackId[checkpoint]!;
            this.retainedCaptureEpoch[slot] = this.retainedCheckpointCaptureEpoch[checkpoint]!;
        }
        this.retainedCheckpointCount = 0;
        this.nextLineageCount = 0;
        this.processorTransformationActive = false;
    }

    private checkpointRetainedSlot(slot: number): void {
        if (!this.processorTransformationActive) {
            return;
        }
        for (let checkpoint = 0; checkpoint < this.retainedCheckpointCount; checkpoint++) {
            if (this.retainedCheckpointSlot[checkpoint] === slot) {
                return;
            }
        }
        if (this.retainedCheckpointCount === YEAST_PREVIEW_CAPACITY) {
            return;
        }
        const checkpoint = this.retainedCheckpointCount++;
        this.retainedCheckpointSlot[checkpoint] = slot;
        this.retainedCheckpointActive[checkpoint] = this.retainedActive[slot]!;
        this.retainedCheckpointGeneration[checkpoint] = this.retainedGeneration[slot]!;
        this.retainedCheckpointReferences[checkpoint] = this.retainedReferences[slot]!;
        this.retainedCheckpointDurationSamples[checkpoint] = this.retainedDurationSamples[slot]!;
        this.retainedCheckpointProbability[checkpoint] = this.retainedProbability[slot]!;
        this.retainedCheckpointHasProbability[checkpoint] = this.retainedHasProbability[slot]!;
        this.retainedCheckpointProcessorId[checkpoint] = this.retainedProcessorId[slot]!;
        this.retainedCheckpointRackId[checkpoint] = this.retainedRackId[slot]!;
        this.retainedCheckpointRouteId[checkpoint] = this.retainedRouteId[slot]!;
        this.retainedCheckpointTrackId[checkpoint] = this.retainedTrackId[slot]!;
        this.retainedCheckpointCaptureEpoch[checkpoint] = this.retainedCaptureEpoch[slot]!;
    }

    recordProcessorEvent(event: MidiEvent, processorId: string, bypassed: boolean, failed: boolean): void {
        if (
            !this.captureRequested ||
            this.originCount === YEAST_PREVIEW_CAPACITY ||
            (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff')
        ) {
            return;
        }
        const slot = this.originCount++;
        this.originEvents[slot] = event;
        this.originProcessorId[slot] = processorId;
        this.originFlags[slot] =
            (bypassed ? YEAST_PREVIEW_BYPASSED_FLAG : 0) | (failed ? YEAST_PREVIEW_FAILED_FLAG : 0);
    }

    recordProcessorEvents(events: readonly MidiEvent[], processorId: string, bypassed: boolean, failed: boolean): void {
        if (!this.captureRequested) {
            return;
        }
        this.beginProcessorEvents();
        for (let index = 0; index < events.length && this.originCount < YEAST_PREVIEW_CAPACITY; index++) {
            this.recordProcessorEvent(events[index]!, processorId, bypassed, failed);
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
        const unrealizedCount = this.sortUnrealizedDecisions();
        let unrealizedIndex = 0;
        for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
            const event = events[eventIndex]!;
            const queuedPreview = this.findQueuedPreviewEvent(event);
            if (queuedPreview !== -1) {
                this.removeQueuedPreview(queuedPreview);
                continue;
            }
            const previewableEvent = event.kind.type === 'noteOn' || event.kind.type === 'noteOff';
            if (previewableEvent && event.timeSamples >= this.blockEndSamples && !this.appendQueuedPreview(event)) {
                this.recordDrop();
                continue;
            }
            const decision = this.findLineageDecision(event);
            const eventSequence = decision < 0 ? this.nextDecisionSequence++ : this.decisionSequence[decision]!;
            while (unrealizedIndex < unrealizedCount) {
                const unrealizedDecision = this.unrealizedOrder[unrealizedIndex]!;
                if (!this.decisionPrecedesEvent(unrealizedDecision, event.timeSamples, eventSequence)) {
                    break;
                }
                this.recordUnrealizedDecision(unrealizedDecision);
                unrealizedIndex += 1;
            }
            this.recordTerminalEvent(event, fallbackTrackId, decision);
        }
        while (unrealizedIndex < unrealizedCount) {
            this.recordUnrealizedDecision(this.unrealizedOrder[unrealizedIndex]!);
            unrealizedIndex += 1;
        }
    }

    private recordTerminalEvent(event: MidiEvent, fallbackTrackId: string, decision: number): void {
        const trackId = event.trackId ?? fallbackTrackId;
        if (event.kind.type === 'noteOn') {
            if (decision === LOST_DECISION || (decision === -1 && this.lineageCompromised)) {
                this.recordDrop();
                return;
            }
            if (!this.captureBlock) {
                this.recordDrop();
                return;
            }
            this.recordNoteOn(event, trackId, decision);
        } else if (event.kind.type === 'noteOff') {
            if (!this.captureBlock) {
                this.dropPendingNoteOff(trackId, event.kind.channel, event.kind.note);
                return;
            }
            this.recordNoteOff(event.timeSamples, trackId, event.kind.channel, event.kind.note);
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
        trackId = this.currentTrackId,
        event?: MidiEvent
    ): void {
        if (!this.captureRequested) {
            return;
        }
        if (this.decisionCount === YEAST_PREVIEW_CAPACITY) {
            if (realized && event && this.processorTransformationActive) {
                this.lineageCompromised = true;
                this.appendNextLineage(event, LOST_DECISION);
            } else {
                this.recordDrop();
            }
            return;
        }
        const slot = this.decisionCount++;
        this.decisionTimeSamples[slot] = timeSamples;
        this.decisionDurationSamples[slot] = durationSamples;
        this.decisionPitch[slot] = pitch;
        this.decisionVelocity[slot] = velocity;
        this.decisionProbability[slot] = probability ?? 0;
        this.decisionHasProbability[slot] = probability === null ? 0 : 1;
        this.decisionRealized[slot] = realized ? 1 : 0;
        this.decisionSequence[slot] = this.nextDecisionSequence++;
        this.decisionTrackId[slot] = trackId;
        this.decisionProcessorId[slot] = processorId;
        if (realized && event && this.processorTransformationActive) {
            this.appendNextLineage(event, slot);
        }
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

    private recordNoteOn(event: MidiEvent, trackId: string, decision: number): void {
        if (event.kind.type !== 'noteOn') {
            return;
        }
        if (this.pendingCount === YEAST_PREVIEW_CAPACITY || this.page.count === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
            return;
        }

        const eventId = this.nextEventId++;
        const beatTime = this.toBeatTime(event.timeSamples);
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
        this.pendingCaptureEpoch[pendingSlot] = routeIndex === -1 ? -1 : this.routeCaptureEpoch[routeIndex]!;
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
        const routeIndex = this.findRouteForTrack(trackId);
        const rackId = routeIndex === -1 ? this.currentRackId : this.routeRackId[routeIndex]!;
        const routeId = routeIndex === -1 ? this.currentRouteId : this.routeId[routeIndex]!;
        const captureEpoch = routeIndex === -1 ? -1 : this.routeCaptureEpoch[routeIndex]!;
        let match = -1;
        let matchSequence = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.pendingCount; index++) {
            if (
                this.pendingPitch[index] === pitch &&
                this.pendingChannel[index] === channel &&
                this.pendingTrackId[index] === trackId &&
                this.pendingRackId[index] === rackId &&
                this.pendingRouteId[index] === routeId &&
                this.pendingCaptureEpoch[index] === captureEpoch &&
                this.pendingSequence[index]! < matchSequence
            ) {
                match = index;
                matchSequence = this.pendingSequence[index]!;
            }
        }
        return match;
    }

    private findOrigin(event: MidiEvent): number {
        for (let index = this.originCount - 1; index >= 0; index--) {
            if (this.originEvents[index] === event) {
                return index;
            }
        }
        return -1;
    }

    private findLineageDecision(event: MidiEvent): number {
        const events = this.lineageUsesA ? this.lineageEventA : this.lineageEventB;
        const decisions = this.lineageUsesA ? this.lineageDecisionA : this.lineageDecisionB;
        for (let index = this.lineageCount - 1; index >= 0; index--) {
            if (events[index] === event) {
                return decisions[index]!;
            }
        }
        return -1;
    }

    private findNextLineageDecision(event: MidiEvent): number {
        const events = this.lineageUsesA ? this.lineageEventB : this.lineageEventA;
        const decisions = this.lineageUsesA ? this.lineageDecisionB : this.lineageDecisionA;
        for (let index = this.nextLineageCount - 1; index >= 0; index--) {
            if (events[index] === event) {
                return decisions[index]!;
            }
        }
        return -1;
    }

    private appendNextLineage(event: MidiEvent, decision: number): void {
        if (this.nextLineageCount === YEAST_PREVIEW_CAPACITY) {
            this.lineageCompromised = true;
            return;
        }
        const events = this.lineageUsesA ? this.lineageEventB : this.lineageEventA;
        const decisions = this.lineageUsesA ? this.lineageDecisionB : this.lineageDecisionA;
        const slot = this.nextLineageCount++;
        events[slot] = event;
        decisions[slot] = decision;
    }

    private sortUnrealizedDecisions(): number {
        let count = 0;
        for (let decision = 0; decision < this.decisionCount; decision++) {
            if (this.decisionRealized[decision] === 0) {
                this.unrealizedOrder[count++] = decision;
            }
        }
        for (let index = 1; index < count; index++) {
            const decision = this.unrealizedOrder[index]!;
            let insertion = index;
            while (insertion > 0 && this.compareDecisions(decision, this.unrealizedOrder[insertion - 1]!) < 0) {
                this.unrealizedOrder[insertion] = this.unrealizedOrder[insertion - 1]!;
                insertion -= 1;
            }
            this.unrealizedOrder[insertion] = decision;
        }
        return count;
    }

    private compareDecisions(alpha: number, beta: number): number {
        const timeDifference = this.decisionTimeSamples[alpha]! - this.decisionTimeSamples[beta]!;
        if (timeDifference !== 0) {
            return timeDifference;
        }
        return this.decisionSequence[alpha]! - this.decisionSequence[beta]!;
    }

    private decisionPrecedesEvent(decision: number, eventTimeSamples: number, eventSequence: number): boolean {
        const timeDifference = this.decisionTimeSamples[decision]! - eventTimeSamples;
        return timeDifference < 0 || (timeDifference === 0 && this.decisionSequence[decision]! < eventSequence);
    }

    private recordUnrealizedDecision(decision: number): void {
        if (!this.captureBlock || this.page.count === YEAST_PREVIEW_CAPACITY) {
            this.recordDrop();
            return;
        }
        const trackId = this.decisionTrackId[decision]!;
        const routeIndex = this.findRouteForTrack(trackId);
        const slot = this.page.count++;
        this.writeEvent(
            slot,
            this.nextEventId++,
            YEAST_PREVIEW_CLOSED_PHASE,
            this.toBeatTime(this.decisionTimeSamples[decision]!),
            Math.max(0, this.decisionDurationSamples[decision]! / this.samplesPerBeat),
            this.decisionPitch[decision]!,
            this.decisionVelocity[decision]!,
            this.decisionHasProbability[decision] === 0 ? null : this.decisionProbability[decision]!,
            false,
            this.decisionProcessorId[decision]!,
            0,
            routeIndex,
            trackId
        );
    }

    private findRoute(rackId: string, routeId: string): number {
        for (let index = 0; index < this.routeCount; index++) {
            if (
                this.routeActive[index] === 1 &&
                this.routeRackId[index] === rackId &&
                this.routeId[index] === routeId
            ) {
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
            if (this.routeActive[index] === 1 && this.routeTrackId[index] === trackId) {
                return index;
            }
        }
        return -1;
    }

    private createRoute(rackId: string, routeId: string, trackId: string): number {
        let index = -1;
        for (let candidate = 0; candidate < this.routeCount; candidate++) {
            if (this.routeActive[candidate] === 0) {
                index = candidate;
                break;
            }
        }
        if (index === -1 && this.routeCount < YEAST_PREVIEW_CAPACITY) {
            index = this.routeCount++;
        }
        if (index === -1) {
            index = this.findOldestRoute();
            if (index === -1) {
                return -1;
            }
            this.retireRoute(index);
        }
        this.routeActive[index] = 1;
        this.routeRackId[index] = rackId;
        this.routeId[index] = routeId;
        this.routeTrackId[index] = trackId;
        this.routeCaptureEpoch[index] = -1;
        this.routeLastUsed[index] = this.nextRouteUseSequence++;
        return index;
    }

    private findOldestRoute(): number {
        let oldestIndex = -1;
        let oldestSequence = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.routeCount; index++) {
            if (this.routeActive[index] === 1 && this.routeLastUsed[index]! < oldestSequence) {
                oldestIndex = index;
                oldestSequence = this.routeLastUsed[index]!;
            }
        }
        return oldestIndex;
    }

    private retireRoute(index: number): void {
        if (this.routeActive[index] === 0) {
            return;
        }
        this.invalidateRoutePending(this.routeRackId[index]!, this.routeId[index]!);
        this.resetRouteMetadata(index);
        this.routeActive[index] = 0;
        this.routeRackId[index] = '';
        this.routeId[index] = '';
        this.routeTrackId[index] = '';
        this.routeCaptureEpoch[index] = -1;
        this.routeLastUsed[index] = 0;
        this.routeResetPending[index] = 0;
    }

    private resetRouteMetadata(index: number): void {
        this.routeDiscontinuityEpoch[index] = 0;
        this.routeHasDiscontinuityEpoch[index] = 0;
        this.routeProjectionVersion[index] = -1;
        this.routeDeferredDrops[index] = 0;
    }

    private invalidateRouteRetained(rackId: string, routeId: string): void {
        for (let index = 0; index < YEAST_PREVIEW_CAPACITY; index++) {
            if (
                this.retainedActive[index] === 1 &&
                this.retainedRackId[index] === rackId &&
                this.retainedRouteId[index] === routeId
            ) {
                this.retainedActive[index] = 0;
                this.retainedReferences[index] = 0;
                this.retainedProcessorId[index] = '';
                this.retainedRackId[index] = '';
                this.retainedRouteId[index] = '';
                this.retainedTrackId[index] = '';
            }
        }
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
        this.pendingCaptureEpoch[index] = this.pendingCaptureEpoch[last]!;
        this.pendingRackId[index] = this.pendingRackId[last]!;
        this.pendingRouteId[index] = this.pendingRouteId[last]!;
        this.pendingTrackId[index] = this.pendingTrackId[last]!;
        this.pendingProcessorId[index] = this.pendingProcessorId[last]!;
    }

    private appendQueuedPreview(event: MidiEvent): boolean {
        if (this.queuedPreviewCount === YEAST_PREVIEW_CAPACITY) {
            return false;
        }
        const slot = this.queuedPreviewCount++;
        this.queuedPreviewEvent[slot] = event;
        return true;
    }

    private findQueuedPreviewEvent(event: MidiEvent): number {
        for (let index = 0; index < this.queuedPreviewCount; index++) {
            if (this.queuedPreviewEvent[index] === event) {
                return index;
            }
        }
        return -1;
    }

    private removeQueuedPreview(index: number): void {
        const last = --this.queuedPreviewCount;
        if (index !== last) {
            this.queuedPreviewEvent[index] = this.queuedPreviewEvent[last];
        }
        this.queuedPreviewEvent[last] = undefined;
    }

    private clearRetainedLineage(): void {
        this.retainedActive.fill(0);
        this.retainedReferences.fill(0);
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
