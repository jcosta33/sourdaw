/**
 * YeastWorkletNode — AudioWorkletNode wrapper for the Yeast MIDI rack.
 *
 * Creates an AudioWorkletNode that hosts MidiRack + all processors in the
 * audio thread. Provides an async `processBlock()` that returns transformed
 * MIDI events; caller supplies `requestId` correlation internally.
 *
 * Sends the serializable processor projection to the worklet. The worklet owns
 * the rack and processor instances; this wrapper owns only the port protocol.
 */

import yeastWorkletProcessorUrl from '../worklets/yeastWorkletProcessor.ts?worker&url';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Upper bound on how long a `processBlock` round-trip may wait for the
 * worklet's `processed` reply before the pending Promise is rejected. Without
 * a bound, a single dropped reply (crashed processor, lost message) leaks an
 * unresolved Promise — and any caller awaiting it — for the lifetime of the
 * page.
 */
// Transport schedules 100 ms ahead and ticks every 10 ms. Reserve one tick
// grain for the remaining scheduler work so Yeast cannot hold the scheduler
// past the current look-ahead window.
const SCHEDULER_LOOKAHEAD_MS = 100;
const SCHEDULER_GRAIN_MS = 10;
export const YEAST_WORKLET_DEADLINE_MS = SCHEDULER_LOOKAHEAD_MS - SCHEDULER_GRAIN_MS;
const ADD_MODULE_TIMEOUT_MS = YEAST_WORKLET_DEADLINE_MS;
const PROCESS_BLOCK_TIMEOUT_MS = YEAST_WORKLET_DEADLINE_MS;
const PROJECTION_ACK_TIMEOUT_MS = YEAST_WORKLET_DEADLINE_MS;
const COMMAND_ACK_TIMEOUT_MS = 1000;
const ALL_NOTES_OFF_ACK_TIMEOUT_MS = 1000;

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
    error?: string;
};

type ParsedAllNotesOffAck = {
    panicId: number;
    ack: YeastAllNotesOffAck;
};

const INVALID_COMMAND_ACK_ERROR = 'Invalid YeastWorkletNode command acknowledgement';
const INVALID_ALL_NOTES_OFF_ACK_ERROR = 'Invalid YeastWorkletNode allNotesOff acknowledgement';
const INVALID_PROJECTION_ACK_ERROR = 'Invalid YeastWorkletNode projection acknowledgement';

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

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isMidiChannel(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 15;
}

function isMidiNote(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127;
}

function isMidiEvent(value: unknown): value is MidiEvent {
    if (!isPlainObject(value) || !isFiniteNumber(value.timeSamples) || !isPlainObject(value.kind)) {
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
        return isMidiChannel(kind.channel) && Number.isInteger(kind.cc) && isFiniteNumber(kind.value);
    }
    if (kind.type === 'pitchBend' || kind.type === 'channelPressure') {
        return isMidiChannel(kind.channel) && isFiniteNumber(kind.value);
    }
    return false;
}

function parseProcessedMessage(value: Record<string, unknown>): { requestId: number; events: MidiEvent[] } | undefined {
    if (value.type !== 'processed' || !isCommandId(value.requestId)) {
        return undefined;
    }
    const events = value.events;
    if (events === undefined) {
        return { requestId: value.requestId, events: [] };
    }
    if (!Array.isArray(events) || !events.every(isMidiEvent)) {
        return undefined;
    }
    return { requestId: value.requestId, events };
}

function parseNotesOffMessage(value: Record<string, unknown>): MidiEvent[] | undefined {
    if (value.type !== 'notesOff') {
        return undefined;
    }
    const events = value.events;
    if (events === undefined) {
        return [];
    }
    if (!Array.isArray(events) || !events.every(isMidiEvent)) {
        return undefined;
    }
    return events;
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

    return {
        panicId: value.panicId,
        ack: error === undefined ? { completed: value.completed } : { completed: value.completed, error },
    };
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function withDeadline<TValue>(promise: Promise<TValue>, timeoutMs: number, message: string): Promise<TValue> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(new Error(message));
        }, timeoutMs);

        void promise.then(
            (value) => {
                if (settled) {
                    return undefined;
                }
                settled = true;
                clearTimeout(timer);
                resolve(value);
                return undefined;
            },
            (error: unknown) => {
                if (settled) {
                    return undefined;
                }
                settled = true;
                clearTimeout(timer);
                reject(toError(error));
                return undefined;
            }
        );
    });
}

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let param = workletRegistrations.get(ctx);
    if (!param) {
        // Evict the cached promise if addModule rejects (CSP/network/syntax)
        // so a later call retries instead of replaying the same rejection.
        // Without this, a single transient failure leaves the worklet path
        // dead until a full page reload.
        let registration: Promise<void>;
        try {
            registration = withDeadline(
                ctx.audioWorklet.addModule(yeastWorkletProcessorUrl),
                ADD_MODULE_TIMEOUT_MS,
                `YeastWorkletNode.addModule timed out after ${ADD_MODULE_TIMEOUT_MS}ms`
            );
        } catch (error: unknown) {
            registration = Promise.reject(toError(error));
        }
        param = registration.catch((error: unknown) => {
            if (workletRegistrations.get(ctx) === param) {
                workletRegistrations.delete(ctx);
            }
            throw error;
        });
        workletRegistrations.set(ctx, param);
    }
    return param;
}

export type YeastWorkletNodeResult = {
    context: BaseAudioContext;
    processBlock: (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo
    ) => Promise<MidiEvent[]>;
    sendCommand: (command: YeastProcessorCommand) => Promise<YeastCommandAck>;
    setProjection: (projection: readonly YeastProcessorProjectionItem[]) => Promise<void>;
    allNotesOff: (nowSamples: number) => Promise<void>;
    /**
     * Register a listener for Note Offs a projection change left hanging in the
     * worklet rack. The worklet computes them and posts them back here; without
     * routing them to the live instrument, the note hangs. Returns an
     * unsubscribe function. Multiple listeners are supported.
     */
    onNotesOff: (handler: (notes: number[]) => void) => () => void;
    destroy: () => void;
};

export async function createYeastWorkletNode(ctx: BaseAudioContext): Promise<YeastWorkletNodeResult> {
    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'yeast-worklet-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 0,
    });

    let nextRequestId = 0;
    let nextCommandId = 0;
    let nextPanicId = 0;
    let nextProjectionId = 0;
    let destroyed = false;
    type PendingEntry = {
        resolve: (events: MidiEvent[]) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
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

    const notesOffHandlers = new Set<(notes: number[]) => void>();

    node.port.onmessage = (event: MessageEvent): void => {
        if (!isPlainObject(event.data)) {
            return;
        }
        const processed = parseProcessedMessage(event.data);
        if (processed) {
            settle(processed.requestId)?.resolve(processed.events);
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
            } else {
                entry.reject(new Error(parsed.ack.error ?? INVALID_ALL_NOTES_OFF_ACK_ERROR));
            }
            return;
        }
        if (event.data.type === 'projectionAck' || event.data.type === 'projectionError') {
            const value = event.data;
            if (!isCommandId(value.projectionId)) {
                return;
            }
            const entry = settleProjection(value.projectionId);
            if (!entry) {
                return;
            }
            if (value.type === 'projectionAck' && value.error === undefined) {
                entry.resolve();
            } else if (value.type === 'projectionError' && typeof value.error === 'string') {
                entry.reject(new Error(value.error));
            } else {
                entry.reject(new Error(INVALID_PROJECTION_ACK_ERROR));
            }
            return;
        }

        const events = parseNotesOffMessage(event.data);
        if (!events) {
            return;
        }
        const notes: number[] = [];
        for (const evt of events) {
            if (evt.kind.type === 'noteOff') {
                notes.push(evt.kind.note);
            }
        }
        if (notes.length > 0) {
            for (const handler of notesOffHandlers) {
                handler(notes);
            }
        }
    };

    const processBlock = (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo
    ): Promise<MidiEvent[]> =>
        new Promise((resolve, reject) => {
            if (destroyed) {
                reject(new Error('YeastWorkletNode is destroyed'));
                return;
            }
            const requestId = nextRequestId++;
            // Reject if the worklet never replies (dropped 'processed' message,
            // crashed processor) so the Promise can't leak forever.
            const timer = setTimeout(() => {
                if (settle(requestId)) {
                    reject(new Error(`YeastWorkletNode.processBlock timed out (requestId ${requestId})`));
                }
            }, PROCESS_BLOCK_TIMEOUT_MS);
            pending.set(requestId, { resolve, reject, timer });
            try {
                node.port.postMessage({ type: 'processBlock', requestId, events, blockStart, blockEnd, transport });
            } catch (error: unknown) {
                settle(requestId)?.reject(toError(error));
            }
        });

    const sendCommand = (command: YeastProcessorCommand): Promise<YeastCommandAck> =>
        new Promise((resolve, reject) => {
            if (destroyed) {
                reject(new Error('YeastWorkletNode is destroyed'));
                return;
            }

            const commandId = nextCommandId++;
            const timer = setTimeout(() => {
                if (settleCommand(commandId)) {
                    reject(new Error(`YeastWorkletNode command acknowledgement timed out (commandId ${commandId})`));
                }
            }, COMMAND_ACK_TIMEOUT_MS);
            pendingCommands.set(commandId, { resolve, reject, timer });
            try {
                node.port.postMessage({ type: 'executeCommand', commandId, command });
            } catch (error: unknown) {
                settleCommand(commandId)?.reject(toError(error));
            }
        });

    const allNotesOff = (nowSamples: number): Promise<void> =>
        new Promise((resolve, reject) => {
            if (destroyed) {
                reject(new Error('YeastWorkletNode is destroyed'));
                return;
            }

            const panicId = nextPanicId++;
            const timer = setTimeout(() => {
                if (settlePanic(panicId)) {
                    reject(new Error(`YeastWorkletNode allNotesOff acknowledgement timed out (panicId ${panicId})`));
                }
            }, ALL_NOTES_OFF_ACK_TIMEOUT_MS);
            pendingPanics.set(panicId, { resolve, reject, timer });
            try {
                node.port.postMessage({ type: 'allNotesOff', panicId, nowSamples });
            } catch (error: unknown) {
                settlePanic(panicId)?.reject(toError(error));
            }
        });

    const setProjection = (projection: readonly YeastProcessorProjectionItem[]): Promise<void> =>
        new Promise((resolve, reject) => {
            if (destroyed) {
                reject(new Error('YeastWorkletNode is destroyed'));
                return;
            }

            const projectionId = nextProjectionId++;
            const timer = setTimeout(() => {
                if (settleProjection(projectionId)) {
                    reject(
                        new Error(
                            `YeastWorkletNode projection acknowledgement timed out (projectionId ${projectionId})`
                        )
                    );
                }
            }, PROJECTION_ACK_TIMEOUT_MS);
            pendingProjections.set(projectionId, { resolve, reject, timer });
            try {
                node.port.postMessage({
                    type: 'setProjection',
                    projectionId,
                    processors: projection.map((processor) => ({
                        ...processor,
                        params: { ...processor.params },
                    })),
                });
            } catch (error: unknown) {
                settleProjection(projectionId)?.reject(toError(error));
            }
        });

    return {
        context: ctx,
        processBlock,
        sendCommand,
        setProjection,
        allNotesOff,
        onNotesOff: (handler) => {
            notesOffHandlers.add(handler);
            return () => {
                notesOffHandlers.delete(handler);
            };
        },
        destroy: () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            // The port is closed; no 'processed' reply can ever arrive. Reject
            // and clear every in-flight request and command so awaiting callers
            // fail fast instead of hanging on Promises that can never settle.
            for (const requestId of [...pending.keys()]) {
                settle(requestId)?.reject(new Error('YeastWorkletNode destroyed before processBlock completed'));
            }
            for (const commandId of [...pendingCommands.keys()]) {
                settleCommand(commandId)?.reject(
                    new Error('YeastWorkletNode destroyed before command acknowledgement')
                );
            }
            for (const panicId of [...pendingPanics.keys()]) {
                settlePanic(panicId)?.reject(
                    new Error('YeastWorkletNode destroyed before allNotesOff acknowledgement')
                );
            }
            for (const projectionId of [...pendingProjections.keys()]) {
                settleProjection(projectionId)?.reject(
                    new Error('YeastWorkletNode destroyed before projection acknowledgement')
                );
            }
            pending.clear();
            pendingCommands.clear();
            pendingPanics.clear();
            pendingProjections.clear();
            notesOffHandlers.clear();
            try {
                node.port.close();
            } catch {
                /* already closed */
            }
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        },
    };
}
