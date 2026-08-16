/**
 * YeastWorkerClient — dedicated Worker wrapper for the Yeast MIDI rack.
 *
 * Creates a dedicated Worker that hosts MidiRack + all processors away from
 * the audio render thread. Provides an async `processBlock()` that returns transformed
 * MIDI events; caller supplies `requestId` correlation internally.
 *
 * Sends the serializable processor projection to the Worker. The Worker owns
 * the rack and processor instances; this wrapper owns only the message protocol.
 */

import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    type YeastPreviewBlock,
    YEAST_PREVIEW_CAPACITY,
    YEAST_PREVIEW_CLOSED_PHASE,
    type YeastPreviewEvent,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_OPEN_PHASE,
    type YeastPreviewPackedPage,
    type YeastPreviewProcessorProvenance,
    YEAST_PREVIEW_REALIZED_FLAG,
    YEAST_PREVIEW_VALID_FLAGS,
} from '../models/YeastPreviewSnapshot';

import type { YeastNoteOffIdentity, YeastNotesOffPayload } from '../events/YeastNotesOffPayload';
import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

/**
 * Upper bound on how long a `processBlock` round-trip may wait for the
 * Worker's `processed` reply before the pending Promise is rejected. Without
 * a bound, a single dropped reply (crashed processor, lost message) leaks an
 * unresolved Promise — and any caller awaiting it — for the lifetime of the
 * page.
 */
// Transport schedules 100 ms ahead and ticks every 10 ms. Reserve one tick
// grain for the remaining scheduler work so Yeast cannot hold the scheduler
// past the current look-ahead window.
const SCHEDULER_LOOKAHEAD_MS = 100;
const SCHEDULER_GRAIN_MS = 10;
export const YEAST_WORKER_DEADLINE_MS = SCHEDULER_LOOKAHEAD_MS - SCHEDULER_GRAIN_MS;
const YEAST_WORKER_PROTOCOL_VERSION = 1;
const STARTUP_TIMEOUT_MS = YEAST_WORKER_DEADLINE_MS;
const PROCESS_BLOCK_TIMEOUT_MS = YEAST_WORKER_DEADLINE_MS;
const PROJECTION_ACK_TIMEOUT_MS = YEAST_WORKER_DEADLINE_MS;
const COMMAND_ACK_TIMEOUT_MS = 1000;
const ALL_NOTES_OFF_ACK_TIMEOUT_MS = 1000;
const PREVIEW_DELIVERY_QUEUE_CAPACITY = 1;
const PREVIEW_ACCEPTANCE_CAPACITY = 16;
const PREVIEW_ROUTE_CAPACITY = YEAST_PREVIEW_CAPACITY;

type YeastCommandAck = {
    accepted: boolean;
    error?: string;
};

type ParsedCommandAck = {
    commandId: number;
    ack: YeastCommandAck;
};

type YeastAllNotesOffAck = {
    completed: boolean;
    events: MidiEvent[];
    error?: string;
};

type ParsedAllNotesOffAck = {
    panicId: number;
    ack: YeastAllNotesOffAck;
};

type ParsedProjectionAck = {
    projectionId: number;
    events: MidiEvent[];
};

const INVALID_COMMAND_ACK_ERROR = 'Invalid YeastWorker command acknowledgement';
const INVALID_ALL_NOTES_OFF_ACK_ERROR = 'Invalid YeastWorker allNotesOff acknowledgement';
const INVALID_PROJECTION_ACK_ERROR = 'Invalid YeastWorker projection acknowledgement';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isCommandId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isReadyMessage(value: unknown): boolean {
    return isPlainObject(value) && value.type === 'ready' && value.protocolVersion === YEAST_WORKER_PROTOCOL_VERSION;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isMidiChannel(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 15;
}

function isMidiNote(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127;
}

function isMidiController(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127;
}

function isTrackId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isMidiEvent(value: unknown): value is MidiEvent {
    if (!isPlainObject(value) || !isFiniteNumber(value.timeSamples) || !isPlainObject(value.kind)) {
        return false;
    }
    if (value.trackId !== undefined && !isTrackId(value.trackId)) {
        return false;
    }
    if (value.durationSamples !== undefined && (!isFiniteNumber(value.durationSamples) || value.durationSamples < 0)) {
        return false;
    }
    if (value.durationPpq !== undefined && (!isFiniteNumber(value.durationPpq) || value.durationPpq < 0)) {
        return false;
    }
    if (value.sourceEventId !== undefined && typeof value.sourceEventId !== 'string') {
        return false;
    }
    if (value.noteInstanceId !== undefined && typeof value.noteInstanceId !== 'string') {
        return false;
    }
    if (value.timePpq !== undefined && !isFiniteNumber(value.timePpq)) {
        return false;
    }
    if (value.tempoBpm !== undefined && !isFiniteNumber(value.tempoBpm)) {
        return false;
    }

    const kind = value.kind;
    if (kind.type === 'noteOn') {
        return isMidiChannel(kind.channel) && isMidiNote(kind.note) && isFiniteNumber(kind.velocity);
    }
    if (kind.type === 'noteOff') {
        return isMidiChannel(kind.channel) && isMidiNote(kind.note);
    }
    if (kind.type === 'cc') {
        return isMidiChannel(kind.channel) && isMidiController(kind.cc) && isFiniteNumber(kind.value);
    }
    if (kind.type === 'pitchBend' || kind.type === 'channelPressure') {
        return isMidiChannel(kind.channel) && isFiniteNumber(kind.value);
    }
    return false;
}

function isNoteOffEvent(value: unknown): value is MidiEvent {
    return isMidiEvent(value) && value.kind.type === 'noteOff' && isTrackId(value.trackId);
}

function parseAcknowledgedNoteOffs(value: Record<string, unknown>, required: boolean): MidiEvent[] | undefined {
    const events = value.events;
    if (events === undefined) {
        return required ? undefined : [];
    }
    if (!Array.isArray(events) || !events.every(isNoteOffEvent)) {
        return undefined;
    }
    return events;
}

function parseProcessedMessage(value: Record<string, unknown>): { requestId: number; events: MidiEvent[] } | undefined {
    if (value.type !== 'processed' || !isCommandId(value.requestId)) {
        return undefined;
    }
    const events = value.events;
    if (!Array.isArray(events) || !events.every(isMidiEvent)) {
        return undefined;
    }
    return { requestId: value.requestId, events };
}

function isPackedPreviewPage(value: unknown): value is YeastPreviewPackedPage {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isTrackId(value.rackId) &&
        isTrackId(value.routeId) &&
        isTrackId(value.trackId) &&
        isCommandId(value.projectionVersion) &&
        typeof value.reset === 'boolean' &&
        isCommandId(value.count) &&
        value.count >= 0 &&
        value.count <= YEAST_PREVIEW_CAPACITY &&
        isCommandId(value.provenanceCount) &&
        value.provenanceCount <= YEAST_PREVIEW_CAPACITY &&
        typeof value.droppedEvents === 'number' &&
        Number.isSafeInteger(value.droppedEvents) &&
        value.droppedEvents >= 0 &&
        value.eventId instanceof Float64Array &&
        value.eventId.length === YEAST_PREVIEW_CAPACITY &&
        value.phase instanceof Uint8Array &&
        value.phase.length === YEAST_PREVIEW_CAPACITY &&
        value.beatTime instanceof Float64Array &&
        value.beatTime.length === YEAST_PREVIEW_CAPACITY &&
        value.durationBeats instanceof Float64Array &&
        value.durationBeats.length === YEAST_PREVIEW_CAPACITY &&
        value.pitch instanceof Uint8Array &&
        value.pitch.length === YEAST_PREVIEW_CAPACITY &&
        value.velocity instanceof Float64Array &&
        value.velocity.length === YEAST_PREVIEW_CAPACITY &&
        value.probability instanceof Float64Array &&
        value.probability.length === YEAST_PREVIEW_CAPACITY &&
        value.flags instanceof Uint8Array &&
        value.flags.length === YEAST_PREVIEW_CAPACITY &&
        Array.isArray(value.rackIds) &&
        value.rackIds.length === YEAST_PREVIEW_CAPACITY &&
        Array.isArray(value.routeIds) &&
        value.routeIds.length === YEAST_PREVIEW_CAPACITY &&
        Array.isArray(value.trackIds) &&
        value.trackIds.length === YEAST_PREVIEW_CAPACITY &&
        Array.isArray(value.processorId) &&
        value.processorId.length === YEAST_PREVIEW_CAPACITY &&
        value.provenanceEventCount instanceof Uint16Array &&
        value.provenanceEventCount.length === YEAST_PREVIEW_CAPACITY &&
        value.provenanceFlags instanceof Uint8Array &&
        value.provenanceFlags.length === YEAST_PREVIEW_CAPACITY &&
        Array.isArray(value.provenanceProcessorId) &&
        value.provenanceProcessorId.length === YEAST_PREVIEW_CAPACITY
    );
}

function parsePreviewPageMessage(
    value: Record<string, unknown>
): { requestId: number; captureEpoch: number; page: YeastPreviewPackedPage } | undefined {
    if (
        value.type !== 'previewPage' ||
        !isCommandId(value.requestId) ||
        !isCommandId(value.captureEpoch) ||
        !isPackedPreviewPage(value.page)
    ) {
        return undefined;
    }
    return { requestId: value.requestId, captureEpoch: value.captureEpoch, page: value.page };
}

function decodePreviewPage(
    page: YeastPreviewPackedPage,
    extraDroppedEvents: number,
    captureEpoch: number
): YeastPreviewBlock | undefined {
    const records: YeastPreviewEvent[] = [];
    for (let index = 0; index < page.count; index++) {
        const eventId = page.eventId[index]!;
        const phase = page.phase[index]!;
        const beatTime = page.beatTime[index]!;
        const durationBeats = page.durationBeats[index]!;
        const pitch = page.pitch[index]!;
        const velocity = page.velocity[index]!;
        const packedProbability = page.probability[index]!;
        const flags = page.flags[index]!;
        const rackId = page.rackIds[index];
        const routeId = page.routeIds[index];
        const trackId = page.trackIds[index];
        const processorId = page.processorId[index];
        if (
            !Number.isSafeInteger(eventId) ||
            eventId < 0 ||
            (phase !== YEAST_PREVIEW_OPEN_PHASE && phase !== YEAST_PREVIEW_CLOSED_PHASE) ||
            !Number.isFinite(beatTime) ||
            !Number.isFinite(durationBeats) ||
            durationBeats < 0 ||
            pitch > 127 ||
            !Number.isFinite(velocity) ||
            (!Number.isNaN(packedProbability) &&
                (!Number.isFinite(packedProbability) || packedProbability < 0 || packedProbability > 1)) ||
            (flags & ~YEAST_PREVIEW_VALID_FLAGS) !== 0 ||
            !isTrackId(rackId) ||
            !isTrackId(routeId) ||
            !isTrackId(trackId) ||
            typeof processorId !== 'string'
        ) {
            return undefined;
        }
        records.push({
            eventId,
            rackId,
            routeId,
            trackId,
            projectionVersion: page.projectionVersion,
            phase: phase === YEAST_PREVIEW_OPEN_PHASE ? 'open' : 'closed',
            beatTime,
            durationBeats,
            pitch,
            velocity,
            probability: Number.isNaN(packedProbability) ? null : packedProbability,
            realized: (flags & YEAST_PREVIEW_REALIZED_FLAG) !== 0,
            processorId: processorId.length === 0 ? null : processorId,
            bypassed: (flags & YEAST_PREVIEW_BYPASSED_FLAG) !== 0,
            failed: (flags & YEAST_PREVIEW_FAILED_FLAG) !== 0,
        });
    }
    const provenance: YeastPreviewProcessorProvenance[] = [];
    for (let index = 0; index < page.provenanceCount; index++) {
        const processorId = page.provenanceProcessorId[index];
        const flags = page.provenanceFlags[index]!;
        if (
            typeof processorId !== 'string' ||
            processorId.length === 0 ||
            (flags & ~(YEAST_PREVIEW_BYPASSED_FLAG | YEAST_PREVIEW_FAILED_FLAG)) !== 0
        ) {
            return undefined;
        }
        provenance.push({
            processorId,
            bypassed: (flags & YEAST_PREVIEW_BYPASSED_FLAG) !== 0,
            failed: (flags & YEAST_PREVIEW_FAILED_FLAG) !== 0,
            eventCount: page.provenanceEventCount[index]!,
        });
    }
    return {
        rackId: page.rackId,
        routeId: page.routeId,
        trackId: page.trackId,
        captureEpoch,
        projectionVersion: page.projectionVersion,
        reset: page.reset,
        records,
        provenance,
        droppedEvents: Math.min(Number.MAX_SAFE_INTEGER, page.droppedEvents + extraDroppedEvents),
    };
}

function parseProcessedError(value: Record<string, unknown>): { requestId: number; error: string } | undefined {
    if (value.type !== 'processedError' || !isCommandId(value.requestId) || typeof value.error !== 'string') {
        return undefined;
    }
    return { requestId: value.requestId, error: value.error };
}

function parseProjectionAck(value: unknown): ParsedProjectionAck | undefined {
    if (!isPlainObject(value) || value.type !== 'projectionAck' || !isCommandId(value.projectionId)) {
        return undefined;
    }
    const events = parseAcknowledgedNoteOffs(value, true);
    if (!events) {
        return undefined;
    }
    return { projectionId: value.projectionId, events };
}

function parseCommandAck(value: unknown): ParsedCommandAck | undefined {
    if (!isPlainObject(value) || value.type !== 'commandAck' || !isCommandId(value.commandId)) {
        return undefined;
    }

    const invalidAck: ParsedCommandAck = {
        commandId: value.commandId,
        ack: { accepted: false, error: INVALID_COMMAND_ACK_ERROR },
    };
    if (typeof value.accepted !== 'boolean') {
        return invalidAck;
    }

    const error = value.error;
    if (value.accepted) {
        return error === undefined ? { commandId: value.commandId, ack: { accepted: true } } : invalidAck;
    }
    if (error !== undefined && typeof error !== 'string') {
        return invalidAck;
    }
    return error === undefined
        ? { commandId: value.commandId, ack: { accepted: false } }
        : { commandId: value.commandId, ack: { accepted: false, error } };
}

function parseAllNotesOffAck(value: unknown): ParsedAllNotesOffAck | undefined {
    if (!isPlainObject(value) || value.type !== 'allNotesOffAck' || !isCommandId(value.panicId)) {
        return undefined;
    }
    if (typeof value.completed !== 'boolean') {
        return undefined;
    }

    const error = value.error;
    if (error !== undefined && typeof error !== 'string') {
        return undefined;
    }
    if (value.completed && error !== undefined) {
        return undefined;
    }

    const events = parseAcknowledgedNoteOffs(value, value.completed);
    if (!events) {
        return undefined;
    }

    return {
        panicId: value.panicId,
        ack:
            error === undefined
                ? { completed: value.completed, events }
                : { completed: value.completed, events, error },
    };
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export type YeastWorkerResult = {
    context: BaseAudioContext;
    processBlock: (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo,
        trackId: string,
        previewEnabled?: boolean,
        rackId?: string,
        routeId?: string,
        captureEpoch?: number,
        preserveInputTrackIds?: boolean
    ) => Promise<MidiEvent[]>;
    sendCommand: (command: YeastProcessorCommand) => Promise<YeastCommandAck>;
    setProjection: (projection: readonly YeastProcessorProjectionItem[]) => Promise<void>;
    allNotesOff: (nowSamples: number) => Promise<void>;
    releasePreview: (
        binding: Readonly<{
            rackId: string;
            routeId: string;
            trackId: string;
            captureEpoch: number;
        }>
    ) => void;
    /**
     * Register a listener for Note Offs a projection change left hanging in the
     * Worker rack. The Worker computes them and posts them back here; without
     * routing them to the live instrument, the note hangs. Returns an
     * unsubscribe function. Multiple listeners are supported.
     */
    onNotesOff: (handler: (notesOff: YeastNotesOffPayload[]) => void) => () => void;
    /** Register a best-effort listener for complete processor preview records. */
    onPreview: (handler: (preview: YeastPreviewBlock) => void) => () => void;
    /** Register for an unrecoverable Worker startup/runtime failure. */
    onTerminalError: (handler: (error: Error) => void) => () => void;
    destroy: () => void;
};

export async function createYeastWorker(ctx: BaseAudioContext): Promise<YeastWorkerResult> {
    const worker = new Worker(new URL('../workers/yeastWorker.ts', import.meta.url), { type: 'module' });

    let nextRequestId = 0;
    let nextCommandId = 0;
    let nextPanicId = 0;
    let nextProjectionId = 0;
    let terminalError: Error | null = null;
    let terminalWasFailure = false;
    let terminated = false;
    let startupResolve: (() => void) | null = null;
    let startupReject: ((error: Error) => void) | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let latestSample = 0;
    const readTerminalError = (): Error | null => terminalError;
    type PreviewScope = {
        rackId: string;
        routeId: string;
        trackId: string;
    };
    type PreviewRouteState = {
        readonly scope: PreviewScope;
        readonly captureEpoch: number;
        readonly acceptedRequestIds: Float64Array;
        readonly acceptedCaptureEpochs: Float64Array;
        acceptedWriteIndex: number;
        readonly queuePages: Array<YeastPreviewPackedPage | undefined>;
        readonly queueExtraDropped: Float64Array;
        readonly queueCaptureEpochs: Float64Array;
        queueReadIndex: number;
        queueSize: number;
        unreportedDrops: number;
        deliveryTimer: ReturnType<typeof setTimeout> | null;
    };
    type PendingEntry = {
        resolve: (events: MidiEvent[]) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        previewEnabled: boolean;
        captureEpoch: number;
        previewRoute: PreviewRouteState | undefined;
    };
    const pending = new Map<number, PendingEntry>();
    type PendingCommandEntry = {
        resolve: (ack: YeastCommandAck) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    };
    const pendingCommands = new Map<number, PendingCommandEntry>();
    type PendingPanicEntry = {
        resolve: () => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    };
    const pendingPanics = new Map<number, PendingPanicEntry>();
    type PendingProjectionEntry = {
        resolve: () => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    };
    const pendingProjections = new Map<number, PendingProjectionEntry>();
    const settle = (requestId: number): PendingEntry | undefined => {
        const entry = pending.get(requestId);
        if (entry) {
            pending.delete(requestId);
            clearTimeout(entry.timer);
        }
        return entry;
    };

    const settleCommand = (commandId: number): PendingCommandEntry | undefined => {
        const entry = pendingCommands.get(commandId);
        if (entry) {
            pendingCommands.delete(commandId);
            clearTimeout(entry.timer);
        }
        return entry;
    };

    const settlePanic = (panicId: number): PendingPanicEntry | undefined => {
        const entry = pendingPanics.get(panicId);
        if (entry) {
            pendingPanics.delete(panicId);
            clearTimeout(entry.timer);
        }
        return entry;
    };

    const settleProjection = (projectionId: number): PendingProjectionEntry | undefined => {
        const entry = pendingProjections.get(projectionId);
        if (entry) {
            pendingProjections.delete(projectionId);
            clearTimeout(entry.timer);
        }
        return entry;
    };

    const notesOffHandlers = new Set<(notesOff: YeastNotesOffPayload[]) => void>();
    const previewHandlers = new Set<(preview: YeastPreviewBlock) => void>();
    const terminalErrorHandlers = new Set<(error: Error) => void>();
    const previewRoutes = new Map<string, Map<string, PreviewRouteState>>();
    let previewRouteCount = 0;

    const createPreviewRoute = (scope: PreviewScope, captureEpoch: number): PreviewRouteState => {
        const acceptedRequestIds = new Float64Array(PREVIEW_ACCEPTANCE_CAPACITY);
        acceptedRequestIds.fill(-1);
        const acceptedCaptureEpochs = new Float64Array(PREVIEW_ACCEPTANCE_CAPACITY);
        acceptedCaptureEpochs.fill(-1);
        return {
            scope,
            captureEpoch,
            acceptedRequestIds,
            acceptedCaptureEpochs,
            acceptedWriteIndex: 0,
            queuePages: Array.from({ length: PREVIEW_DELIVERY_QUEUE_CAPACITY }),
            queueExtraDropped: new Float64Array(PREVIEW_DELIVERY_QUEUE_CAPACITY),
            queueCaptureEpochs: new Float64Array(PREVIEW_DELIVERY_QUEUE_CAPACITY),
            queueReadIndex: 0,
            queueSize: 0,
            unreportedDrops: 0,
            deliveryTimer: null,
        };
    };

    const getPreviewRoute = (scope: PreviewScope, captureEpoch: number): PreviewRouteState => {
        const rackRoutes = previewRoutes.get(scope.rackId);
        const existing = rackRoutes?.get(scope.routeId);
        if (existing?.captureEpoch === captureEpoch && existing.scope.trackId === scope.trackId) {
            return existing;
        }
        if (existing) {
            clearPreviewDelivery(existing);
        } else if (previewRouteCount === PREVIEW_ROUTE_CAPACITY) {
            evictOldestPreviewRoute();
        }
        const route = createPreviewRoute(scope, captureEpoch);
        const nextRackRoutes = rackRoutes ?? new Map<string, PreviewRouteState>();
        nextRackRoutes.set(scope.routeId, route);
        previewRoutes.set(scope.rackId, nextRackRoutes);
        if (!existing) {
            previewRouteCount += 1;
        }
        return route;
    };

    const findPreviewRoute = (scope: PreviewScope): PreviewRouteState | undefined => {
        const route = previewRoutes.get(scope.rackId)?.get(scope.routeId);
        return route?.scope.trackId === scope.trackId ? route : undefined;
    };

    const rememberPreviewRequest = (route: PreviewRouteState, requestId: number, captureEpoch: number): void => {
        route.acceptedRequestIds[route.acceptedWriteIndex] = requestId;
        route.acceptedCaptureEpochs[route.acceptedWriteIndex] = captureEpoch;
        route.acceptedWriteIndex = (route.acceptedWriteIndex + 1) % PREVIEW_ACCEPTANCE_CAPACITY;
    };

    const consumePreviewRequest = (route: PreviewRouteState, requestId: number, captureEpoch: number): boolean => {
        for (let index = 0; index < route.acceptedRequestIds.length; index++) {
            if (route.acceptedRequestIds[index] === requestId && route.acceptedCaptureEpochs[index] === captureEpoch) {
                route.acceptedRequestIds[index] = -1;
                route.acceptedCaptureEpochs[index] = -1;
                return true;
            }
        }
        return false;
    };

    const accountPreviewDrops = (route: PreviewRouteState, droppedEvents: number): void => {
        if (droppedEvents <= 0) {
            return;
        }
        if (route.queueSize > 0) {
            const lastIndex = (route.queueReadIndex + route.queueSize - 1) % PREVIEW_DELIVERY_QUEUE_CAPACITY;
            route.queueExtraDropped[lastIndex] = Math.min(
                Number.MAX_SAFE_INTEGER,
                route.queueExtraDropped[lastIndex]! + droppedEvents
            );
            return;
        }
        route.unreportedDrops = Math.min(Number.MAX_SAFE_INTEGER, route.unreportedDrops + droppedEvents);
    };

    const schedulePreviewDelivery = (route: PreviewRouteState): void => {
        if (route.deliveryTimer !== null || route.queueSize === 0) {
            return;
        }
        route.deliveryTimer = setTimeout(() => {
            route.deliveryTimer = null;
            const index = route.queueReadIndex;
            const page = route.queuePages[index];
            const extraDroppedEvents = route.queueExtraDropped[index]!;
            const captureEpoch = route.queueCaptureEpochs[index]!;
            route.queuePages[index] = undefined;
            route.queueExtraDropped[index] = 0;
            route.queueCaptureEpochs[index] = 0;
            route.queueReadIndex = (route.queueReadIndex + 1) % PREVIEW_DELIVERY_QUEUE_CAPACITY;
            route.queueSize -= 1;

            const currentRoute = findPreviewRoute(route.scope);
            if (page && currentRoute === route && captureEpoch === route.captureEpoch) {
                const preview = decodePreviewPage(page, extraDroppedEvents, captureEpoch);
                if (preview) {
                    const handlers = [...previewHandlers];
                    for (const handler of handlers) {
                        try {
                            handler(preview);
                        } catch {
                            // A failed/reentrant observer cannot affect this delivery snapshot.
                        }
                    }
                } else {
                    accountPreviewDrops(route, page.count + page.droppedEvents + extraDroppedEvents);
                }
            }
            schedulePreviewDelivery(route);
        }, 0);
    };

    const enqueuePreviewPage = (route: PreviewRouteState, page: YeastPreviewPackedPage, captureEpoch: number): void => {
        if (route.queueSize === PREVIEW_DELIVERY_QUEUE_CAPACITY) {
            accountPreviewDrops(route, page.count + page.droppedEvents);
            return;
        }
        const index = (route.queueReadIndex + route.queueSize) % PREVIEW_DELIVERY_QUEUE_CAPACITY;
        route.queuePages[index] = page;
        route.queueExtraDropped[index] = route.unreportedDrops;
        route.queueCaptureEpochs[index] = captureEpoch;
        route.unreportedDrops = 0;
        route.queueSize += 1;
        schedulePreviewDelivery(route);
    };

    const clearPreviewDelivery = (route: PreviewRouteState): void => {
        if (route.deliveryTimer !== null) {
            clearTimeout(route.deliveryTimer);
            route.deliveryTimer = null;
        }
        for (let index = 0; index < route.queuePages.length; index++) {
            route.queuePages[index] = undefined;
            route.queueExtraDropped[index] = 0;
            route.queueCaptureEpochs[index] = 0;
        }
        route.queueReadIndex = 0;
        route.queueSize = 0;
        route.unreportedDrops = 0;
        route.acceptedRequestIds.fill(-1);
        route.acceptedCaptureEpochs.fill(-1);
        route.acceptedWriteIndex = 0;
    };

    const removePreviewRoute = (scope: PreviewScope, captureEpoch?: number): void => {
        const rackRoutes = previewRoutes.get(scope.rackId);
        const route = rackRoutes?.get(scope.routeId);
        if (
            !rackRoutes ||
            !route ||
            route.scope.trackId !== scope.trackId ||
            (captureEpoch !== undefined && route.captureEpoch !== captureEpoch)
        ) {
            return;
        }
        clearPreviewDelivery(route);
        rackRoutes.delete(scope.routeId);
        previewRouteCount -= 1;
        if (rackRoutes.size === 0) {
            previewRoutes.delete(scope.rackId);
        }
    };

    const evictOldestPreviewRoute = (): void => {
        for (const [rackId, rackRoutes] of previewRoutes) {
            const oldest = rackRoutes.entries().next().value;
            if (!oldest) {
                continue;
            }
            clearPreviewDelivery(oldest[1]);
            rackRoutes.delete(oldest[0]);
            previewRouteCount -= 1;
            if (rackRoutes.size === 0) {
                previewRoutes.delete(rackId);
            }
            return;
        }
    };

    const clearAllPreviewDelivery = (): void => {
        for (const rackRoutes of previewRoutes.values()) {
            for (const route of rackRoutes.values()) {
                clearPreviewDelivery(route);
            }
        }
        previewRoutes.clear();
        previewRouteCount = 0;
    };

    const dispatchNotesOff = (events: readonly MidiEvent[]): void => {
        const notesOffByTrack = new Map<string, YeastNoteOffIdentity[]>();
        const seenByTrackAndChannel = new Map<string, Map<number, Set<number>>>();
        for (const evt of events) {
            if (evt.kind.type !== 'noteOff' || !evt.trackId) {
                continue;
            }
            const seenByChannel = seenByTrackAndChannel.get(evt.trackId) ?? new Map<number, Set<number>>();
            const seenNotes = seenByChannel.get(evt.kind.channel) ?? new Set<number>();
            if (seenNotes.has(evt.kind.note)) {
                continue;
            }
            seenNotes.add(evt.kind.note);
            seenByChannel.set(evt.kind.channel, seenNotes);
            seenByTrackAndChannel.set(evt.trackId, seenByChannel);

            const noteOffs = notesOffByTrack.get(evt.trackId) ?? [];
            noteOffs.push({ channel: evt.kind.channel, note: evt.kind.note });
            notesOffByTrack.set(evt.trackId, noteOffs);
        }
        if (notesOffByTrack.size === 0) {
            return;
        }
        const notesOff = [...notesOffByTrack].map(([trackId, noteOffs]) => ({ trackId, noteOffs }));
        const handlers = [...notesOffHandlers];
        for (const handler of handlers) {
            try {
                handler(notesOff);
            } catch {
                // A failed/reentrant observer cannot affect this delivery snapshot.
            }
        }
    };

    type PendingFailureErrors = {
        process: Error;
        command: Error;
        panic: Error;
        projection: Error;
    };

    const closeClient = (input: {
        error: Error;
        notifyTerminalHandlers: boolean;
        pendingErrors?: PendingFailureErrors;
    }): void => {
        if (terminalError) {
            return;
        }

        terminalError = input.error;
        terminalWasFailure = input.notifyTerminalHandlers;
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;

        if (startupTimer !== null) {
            clearTimeout(startupTimer);
            startupTimer = null;
        }
        const rejectStartup = startupReject;
        startupResolve = null;
        startupReject = null;

        const pendingErrors = input.pendingErrors ?? {
            process: input.error,
            command: input.error,
            panic: input.error,
            projection: input.error,
        };
        for (const requestId of [...pending.keys()]) {
            settle(requestId)?.reject(pendingErrors.process);
        }
        for (const commandId of [...pendingCommands.keys()]) {
            settleCommand(commandId)?.reject(pendingErrors.command);
        }
        for (const panicId of [...pendingPanics.keys()]) {
            settlePanic(panicId)?.reject(pendingErrors.panic);
        }
        for (const projectionId of [...pendingProjections.keys()]) {
            settleProjection(projectionId)?.reject(pendingErrors.projection);
        }
        clearAllPreviewDelivery();
        notesOffHandlers.clear();
        previewHandlers.clear();

        const handlers = input.notifyTerminalHandlers ? [...terminalErrorHandlers] : [];
        terminalErrorHandlers.clear();
        rejectStartup?.(input.error);
        if (!terminated) {
            terminated = true;
            worker.terminate();
        }
        for (const handler of handlers) {
            try {
                handler(input.error);
            } catch {
                // A failed observer cannot leave later terminal observers unnotified.
            }
        }
    };

    const acknowledgeReady = (): void => {
        const resolveStartup = startupResolve;
        if (!resolveStartup) {
            return;
        }
        if (startupTimer !== null) {
            clearTimeout(startupTimer);
            startupTimer = null;
        }
        startupResolve = null;
        startupReject = null;
        resolveStartup();
    };

    worker.onmessage = (event: MessageEvent): void => {
        if (isReadyMessage(event.data)) {
            acknowledgeReady();
            return;
        }
        if (!isPlainObject(event.data)) {
            return;
        }
        const processed = parseProcessedMessage(event.data);
        if (processed) {
            const entry = settle(processed.requestId);
            if (!entry) {
                return;
            }
            entry.resolve(processed.events);
            if (
                entry.previewEnabled &&
                entry.previewRoute &&
                findPreviewRoute(entry.previewRoute.scope) === entry.previewRoute &&
                entry.captureEpoch === entry.previewRoute.captureEpoch
            ) {
                rememberPreviewRequest(entry.previewRoute, processed.requestId, entry.captureEpoch);
            }
            return;
        }
        if (event.data.type === 'previewPage') {
            const parsed = parsePreviewPageMessage(event.data);
            if (!parsed) {
                return;
            }
            const route = findPreviewRoute({
                rackId: parsed.page.rackId,
                routeId: parsed.page.routeId,
                trackId: parsed.page.trackId,
            });
            if (!route || route.scope.trackId !== parsed.page.trackId || parsed.captureEpoch !== route.captureEpoch) {
                return;
            }
            if (!consumePreviewRequest(route, parsed.requestId, parsed.captureEpoch)) {
                accountPreviewDrops(route, parsed.page.count + parsed.page.droppedEvents);
                return;
            }
            enqueuePreviewPage(route, parsed.page, parsed.captureEpoch);
            return;
        }
        if (event.data.type === 'processedError') {
            const parsed = parseProcessedError(event.data);
            if (!parsed) {
                return;
            }
            settle(parsed.requestId)?.reject(new Error(parsed.error));
            return;
        }
        if (event.data.type === 'commandAck') {
            const parsed = parseCommandAck(event.data);
            if (parsed) {
                settleCommand(parsed.commandId)?.resolve(parsed.ack);
            }
            return;
        }
        if (event.data.type === 'allNotesOffAck') {
            const parsed = parseAllNotesOffAck(event.data);
            if (!parsed) {
                return;
            }
            const entry = settlePanic(parsed.panicId);
            if (!entry) {
                return;
            }
            if (parsed.ack.completed) {
                entry.resolve();
                dispatchNotesOff(parsed.ack.events);
            } else {
                entry.reject(new Error(parsed.ack.error ?? INVALID_ALL_NOTES_OFF_ACK_ERROR));
            }
            return;
        }
        if (event.data.type === 'projectionAck') {
            const parsed = parseProjectionAck(event.data);
            if (!parsed) {
                return;
            }
            const entry = settleProjection(parsed.projectionId);
            if (!entry) {
                return;
            }
            entry.resolve();
            dispatchNotesOff(parsed.events);
            return;
        }
        if (event.data.type === 'projectionError') {
            const value = event.data;
            if (!isCommandId(value.projectionId)) {
                return;
            }
            const entry = settleProjection(value.projectionId);
            if (!entry) {
                return;
            }
            if (typeof value.error === 'string') {
                entry.reject(new Error(value.error));
            } else {
                entry.reject(new Error(INVALID_PROJECTION_ACK_ERROR));
            }
            return;
        }
    };

    worker.onerror = (event: ErrorEvent): void => {
        event.preventDefault();
        closeClient({
            error: new Error(event.message || 'YeastWorker runtime failed'),
            notifyTerminalHandlers: true,
        });
    };
    worker.onmessageerror = (): void => {
        closeClient({
            error: new Error('YeastWorker message decoding failed'),
            notifyTerminalHandlers: true,
        });
    };

    const processBlock = (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo,
        trackId: string,
        previewEnabled = false,
        rackId = trackId,
        routeId = trackId,
        captureEpoch = previewEnabled ? 1 : 0,
        preserveInputTrackIds = false
    ): Promise<MidiEvent[]> =>
        new Promise((resolve, reject) => {
            if (terminalError) {
                reject(terminalError);
                return;
            }
            const previewScope = { rackId, routeId, trackId };
            const previewRoute = previewEnabled ? getPreviewRoute(previewScope, captureEpoch) : undefined;
            if (!previewEnabled) {
                removePreviewRoute(previewScope);
            }
            const requestId = nextRequestId++;
            latestSample = Math.max(latestSample, blockEnd);
            // Reject if the Worker never replies (dropped 'processed' message,
            // crashed processor) so the Promise can't leak forever.
            const timer = setTimeout(() => {
                if (settle(requestId)) {
                    reject(new Error(`YeastWorker.processBlock timed out (requestId ${requestId})`));
                }
            }, PROCESS_BLOCK_TIMEOUT_MS);
            pending.set(requestId, { resolve, reject, timer, previewEnabled, captureEpoch, previewRoute });
            try {
                worker.postMessage({
                    type: 'processBlock',
                    requestId,
                    events,
                    blockStart,
                    blockEnd,
                    transport,
                    rackId,
                    routeId,
                    trackId,
                    previewEnabled,
                    captureEpoch,
                    preserveInputTrackIds,
                });
            } catch (error: unknown) {
                settle(requestId)?.reject(toError(error));
            }
        });

    const sendCommand = (command: YeastProcessorCommand): Promise<YeastCommandAck> =>
        new Promise((resolve, reject) => {
            if (terminalError) {
                reject(terminalError);
                return;
            }

            const commandId = nextCommandId++;
            const timer = setTimeout(() => {
                if (settleCommand(commandId)) {
                    reject(new Error(`YeastWorker command acknowledgement timed out (commandId ${commandId})`));
                }
            }, COMMAND_ACK_TIMEOUT_MS);
            pendingCommands.set(commandId, { resolve, reject, timer });
            try {
                worker.postMessage({ type: 'executeCommand', commandId, command });
            } catch (error: unknown) {
                settleCommand(commandId)?.reject(toError(error));
            }
        });

    const allNotesOff = (nowSamples: number): Promise<void> =>
        new Promise((resolve, reject) => {
            if (terminalError) {
                reject(terminalError);
                return;
            }

            const panicId = nextPanicId++;
            latestSample = Math.max(latestSample, nowSamples);
            const timer = setTimeout(() => {
                if (settlePanic(panicId)) {
                    reject(new Error(`YeastWorker allNotesOff acknowledgement timed out (panicId ${panicId})`));
                }
            }, ALL_NOTES_OFF_ACK_TIMEOUT_MS);
            pendingPanics.set(panicId, { resolve, reject, timer });
            try {
                worker.postMessage({ type: 'allNotesOff', panicId, nowSamples });
            } catch (error: unknown) {
                settlePanic(panicId)?.reject(toError(error));
            }
        });

    const releasePreview: YeastWorkerResult['releasePreview'] = (binding): void => {
        if (terminalError) {
            return;
        }
        removePreviewRoute(binding, binding.captureEpoch);
        try {
            worker.postMessage({ type: 'releasePreview', ...binding });
        } catch {
            // Preview retirement is best effort and cannot affect scheduler output.
        }
    };

    const setProjection = (projection: readonly YeastProcessorProjectionItem[]): Promise<void> =>
        new Promise((resolve, reject) => {
            if (terminalError) {
                reject(terminalError);
                return;
            }

            const projectionId = nextProjectionId++;
            const timer = setTimeout(() => {
                if (settleProjection(projectionId)) {
                    reject(
                        new Error(`YeastWorker projection acknowledgement timed out (projectionId ${projectionId})`)
                    );
                }
            }, PROJECTION_ACK_TIMEOUT_MS);
            pendingProjections.set(projectionId, { resolve, reject, timer });
            try {
                worker.postMessage({
                    type: 'setProjection',
                    projectionId,
                    nowSamples: latestSample,
                    processors: projection.map((processor) => ({
                        ...processor,
                        params: { ...processor.params },
                    })),
                });
            } catch (error: unknown) {
                settleProjection(projectionId)?.reject(toError(error));
            }
        });

    const startup = new Promise<void>((resolve, reject) => {
        startupResolve = resolve;
        startupReject = reject;
        startupTimer = setTimeout(() => {
            closeClient({
                error: new Error(`YeastWorker startup timed out after ${STARTUP_TIMEOUT_MS}ms`),
                notifyTerminalHandlers: true,
            });
        }, STARTUP_TIMEOUT_MS);
        try {
            worker.postMessage({ type: 'initialize', protocolVersion: YEAST_WORKER_PROTOCOL_VERSION });
        } catch (error: unknown) {
            closeClient({ error: toError(error), notifyTerminalHandlers: true });
        }
    });
    await startup;
    const startupFailure = readTerminalError();
    if (startupFailure) {
        throw startupFailure;
    }

    return {
        context: ctx,
        processBlock,
        sendCommand,
        setProjection,
        allNotesOff,
        releasePreview,
        onNotesOff: (handler) => {
            if (terminalError) {
                return () => {};
            }
            notesOffHandlers.add(handler);
            return () => {
                notesOffHandlers.delete(handler);
            };
        },
        onPreview: (handler) => {
            if (terminalError) {
                return () => {};
            }
            previewHandlers.add(handler);
            return () => {
                previewHandlers.delete(handler);
            };
        },
        onTerminalError: (handler) => {
            if (terminalError) {
                if (terminalWasFailure) {
                    handler(terminalError);
                }
                return () => {};
            }
            terminalErrorHandlers.add(handler);
            return () => {
                terminalErrorHandlers.delete(handler);
            };
        },
        destroy: () => {
            closeClient({
                error: new Error('YeastWorker is destroyed'),
                notifyTerminalHandlers: false,
                pendingErrors: {
                    process: new Error('YeastWorker destroyed before processBlock completed'),
                    command: new Error('YeastWorker destroyed before command acknowledgement'),
                    panic: new Error('YeastWorker destroyed before allNotesOff acknowledgement'),
                    projection: new Error('YeastWorker destroyed before projection acknowledgement'),
                },
            });
        },
    };
}
