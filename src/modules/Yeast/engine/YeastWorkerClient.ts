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
    type YeastPreviewEvent,
    YEAST_PREVIEW_FAILED_FLAG,
    type YeastPreviewPackedPage,
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
    if (!isPlainObject(value) || !isFiniteNumber(value.timeSamples) || !isPlainObject(value.kind)) {
        return false;
    }
    return (
        value.kind.type === 'noteOff' &&
        isMidiChannel(value.kind.channel) &&
        isMidiNote(value.kind.note) &&
        isTrackId(value.trackId)
    );
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
        typeof value.count === 'number' &&
        Number.isSafeInteger(value.count) &&
        value.count >= 0 &&
        value.count <= YEAST_PREVIEW_CAPACITY &&
        typeof value.droppedEvents === 'number' &&
        Number.isSafeInteger(value.droppedEvents) &&
        value.droppedEvents >= 0 &&
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
        Array.isArray(value.processorId) &&
        value.processorId.length === YEAST_PREVIEW_CAPACITY
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

function decodePreviewPage(page: YeastPreviewPackedPage, extraDroppedEvents: number): YeastPreviewBlock | undefined {
    const records: YeastPreviewEvent[] = [];
    for (let index = 0; index < page.count; index++) {
        const beatTime = page.beatTime[index]!;
        const durationBeats = page.durationBeats[index]!;
        const pitch = page.pitch[index]!;
        const velocity = page.velocity[index]!;
        const packedProbability = page.probability[index]!;
        const flags = page.flags[index]!;
        const processorId = page.processorId[index];
        if (
            !Number.isFinite(beatTime) ||
            !Number.isFinite(durationBeats) ||
            durationBeats < 0 ||
            pitch > 127 ||
            !Number.isFinite(velocity) ||
            (!Number.isNaN(packedProbability) &&
                (!Number.isFinite(packedProbability) || packedProbability < 0 || packedProbability > 1)) ||
            (flags & ~YEAST_PREVIEW_VALID_FLAGS) !== 0 ||
            typeof processorId !== 'string' ||
            processorId.length === 0
        ) {
            return undefined;
        }
        records.push({
            beatTime,
            durationBeats,
            pitch,
            velocity,
            probability: Number.isNaN(packedProbability) ? null : packedProbability,
            realized: (flags & YEAST_PREVIEW_REALIZED_FLAG) !== 0,
            processorId,
            bypassed: (flags & YEAST_PREVIEW_BYPASSED_FLAG) !== 0,
            failed: (flags & YEAST_PREVIEW_FAILED_FLAG) !== 0,
        });
    }
    return {
        records,
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
        previewEnabled?: boolean
    ) => Promise<MidiEvent[]>;
    sendCommand: (command: YeastProcessorCommand) => Promise<YeastCommandAck>;
    setProjection: (projection: readonly YeastProcessorProjectionItem[]) => Promise<void>;
    allNotesOff: (nowSamples: number) => Promise<void>;
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
    let previewCaptureEnabled = false;
    let previewCaptureEpoch = 0;
    const readTerminalError = (): Error | null => terminalError;
    type PendingEntry = {
        resolve: (events: MidiEvent[]) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        previewEnabled: boolean;
        captureEpoch: number;
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
    const acceptedPreviewRequestIds = new Float64Array(PREVIEW_ACCEPTANCE_CAPACITY);
    acceptedPreviewRequestIds.fill(-1);
    const acceptedPreviewCaptureEpochs = new Float64Array(PREVIEW_ACCEPTANCE_CAPACITY);
    acceptedPreviewCaptureEpochs.fill(-1);
    let acceptedPreviewWriteIndex = 0;
    const previewQueuePages: Array<YeastPreviewPackedPage | undefined> = Array.from({
        length: PREVIEW_DELIVERY_QUEUE_CAPACITY,
    });
    const previewQueueExtraDropped = new Float64Array(PREVIEW_DELIVERY_QUEUE_CAPACITY);
    let previewQueueReadIndex = 0;
    let previewQueueSize = 0;
    let unreportedPreviewDrops = 0;
    let previewDeliveryTimer: ReturnType<typeof setTimeout> | null = null;

    const rememberPreviewRequest = (requestId: number, captureEpoch: number): void => {
        acceptedPreviewRequestIds[acceptedPreviewWriteIndex] = requestId;
        acceptedPreviewCaptureEpochs[acceptedPreviewWriteIndex] = captureEpoch;
        acceptedPreviewWriteIndex = (acceptedPreviewWriteIndex + 1) % PREVIEW_ACCEPTANCE_CAPACITY;
    };

    const consumePreviewRequest = (requestId: number, captureEpoch: number): boolean => {
        for (let index = 0; index < acceptedPreviewRequestIds.length; index++) {
            if (
                acceptedPreviewRequestIds[index] === requestId &&
                acceptedPreviewCaptureEpochs[index] === captureEpoch
            ) {
                acceptedPreviewRequestIds[index] = -1;
                acceptedPreviewCaptureEpochs[index] = -1;
                return true;
            }
        }
        return false;
    };

    const accountPreviewDrops = (droppedEvents: number): void => {
        if (droppedEvents <= 0) {
            return;
        }
        if (previewQueueSize > 0) {
            const lastIndex = (previewQueueReadIndex + previewQueueSize - 1) % PREVIEW_DELIVERY_QUEUE_CAPACITY;
            previewQueueExtraDropped[lastIndex] = Math.min(
                Number.MAX_SAFE_INTEGER,
                previewQueueExtraDropped[lastIndex]! + droppedEvents
            );
            return;
        }
        unreportedPreviewDrops = Math.min(Number.MAX_SAFE_INTEGER, unreportedPreviewDrops + droppedEvents);
    };

    const schedulePreviewDelivery = (): void => {
        if (previewDeliveryTimer !== null || previewQueueSize === 0) {
            return;
        }
        previewDeliveryTimer = setTimeout(() => {
            previewDeliveryTimer = null;
            const index = previewQueueReadIndex;
            const page = previewQueuePages[index];
            const extraDroppedEvents = previewQueueExtraDropped[index]!;
            previewQueuePages[index] = undefined;
            previewQueueExtraDropped[index] = 0;
            previewQueueReadIndex = (previewQueueReadIndex + 1) % PREVIEW_DELIVERY_QUEUE_CAPACITY;
            previewQueueSize -= 1;

            if (page) {
                const preview = decodePreviewPage(page, extraDroppedEvents);
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
                    accountPreviewDrops(page.count + page.droppedEvents + extraDroppedEvents);
                }
            }
            schedulePreviewDelivery();
        }, 0);
    };

    const enqueuePreviewPage = (page: YeastPreviewPackedPage): void => {
        if (previewQueueSize === PREVIEW_DELIVERY_QUEUE_CAPACITY) {
            accountPreviewDrops(page.count + page.droppedEvents);
            return;
        }
        const index = (previewQueueReadIndex + previewQueueSize) % PREVIEW_DELIVERY_QUEUE_CAPACITY;
        previewQueuePages[index] = page;
        previewQueueExtraDropped[index] = unreportedPreviewDrops;
        unreportedPreviewDrops = 0;
        previewQueueSize += 1;
        schedulePreviewDelivery();
    };

    const clearPreviewDelivery = (): void => {
        if (previewDeliveryTimer !== null) {
            clearTimeout(previewDeliveryTimer);
            previewDeliveryTimer = null;
        }
        for (let index = 0; index < previewQueuePages.length; index++) {
            previewQueuePages[index] = undefined;
            previewQueueExtraDropped[index] = 0;
        }
        previewQueueReadIndex = 0;
        previewQueueSize = 0;
        unreportedPreviewDrops = 0;
        acceptedPreviewRequestIds.fill(-1);
        acceptedPreviewCaptureEpochs.fill(-1);
        acceptedPreviewWriteIndex = 0;
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
        for (const handler of notesOffHandlers) {
            handler(notesOff);
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
        clearPreviewDelivery();
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
            if (entry.previewEnabled && entry.captureEpoch === previewCaptureEpoch) {
                rememberPreviewRequest(processed.requestId, entry.captureEpoch);
            }
            return;
        }
        if (event.data.type === 'previewPage') {
            const parsed = parsePreviewPageMessage(event.data);
            if (!parsed) {
                return;
            }
            if (parsed.captureEpoch !== previewCaptureEpoch) {
                return;
            }
            if (!consumePreviewRequest(parsed.requestId, parsed.captureEpoch)) {
                accountPreviewDrops(parsed.page.count + parsed.page.droppedEvents);
                return;
            }
            enqueuePreviewPage(parsed.page);
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
        previewEnabled = false
    ): Promise<MidiEvent[]> =>
        new Promise((resolve, reject) => {
            if (terminalError) {
                reject(terminalError);
                return;
            }
            if (previewEnabled !== previewCaptureEnabled) {
                previewCaptureEnabled = previewEnabled;
                previewCaptureEpoch += 1;
                clearPreviewDelivery();
            }
            const captureEpoch = previewCaptureEpoch;
            const requestId = nextRequestId++;
            latestSample = Math.max(latestSample, blockEnd);
            // Reject if the Worker never replies (dropped 'processed' message,
            // crashed processor) so the Promise can't leak forever.
            const timer = setTimeout(() => {
                if (settle(requestId)) {
                    reject(new Error(`YeastWorker.processBlock timed out (requestId ${requestId})`));
                }
            }, PROCESS_BLOCK_TIMEOUT_MS);
            pending.set(requestId, { resolve, reject, timer, previewEnabled, captureEpoch });
            try {
                worker.postMessage({
                    type: 'processBlock',
                    requestId,
                    events,
                    blockStart,
                    blockEnd,
                    transport,
                    trackId,
                    previewEnabled,
                    captureEpoch,
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
