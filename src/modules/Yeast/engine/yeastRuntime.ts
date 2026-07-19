import { logger } from '#/infra/logger/appLogger';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { createYeastWorker, type YeastWorkerResult } from './YeastWorkerClient';

import type { YeastNotesOffPayload } from '../events/YeastNotesOffPayload';
import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type {
    YeastProcessorProjection,
    YeastProcessorProjectionItem,
    YeastRuntimeStatus,
} from '../models/YeastProcessorProjection';

type ProcessYeastRuntimeBlockInput = {
    context: BaseAudioContext;
    trackId: string;
    events: readonly MidiEvent[];
    blockStartSamples: number;
    blockEndSamples: number;
    transport: TransportInfo;
};

type ProcessYeastRuntimeTransactionInput = ProcessYeastRuntimeBlockInput & {
    projection: readonly YeastProcessorProjectionItem[];
};

type YeastRuntimeSession = {
    version: number;
    context: BaseAudioContext | null;
    node: YeastWorkerResult | null;
    nodePromise: Promise<YeastWorkerResult | null> | null;
    projection: YeastProcessorProjection;
    processTail: Promise<void>;
    generation: number;
    projectionRevision: number;
    appliedProjectionRevision: number;
    status: YeastRuntimeStatus;
    error: string | undefined;
    onNotesOff: ((notesOff: YeastNotesOffPayload[]) => void) | null;
    pendingNotesOff: YeastNotesOffPayload[];
    onOutputPanic: (() => void) | null;
    pendingOutputPanic: boolean;
    pendingAllNotesOff: PendingAllNotesOff | null;
    activeOutputNotes: Map<string, ActiveOutputNote>;
};

type ActiveOutputNote = {
    generation: number;
    trackId: string;
    channel: number;
    note: number;
    noteInstanceId?: string;
};

type PendingAllNotesOff = {
    context: BaseAudioContext;
    generation: number;
    nowSamples: number;
};

const YEAST_RUNTIME_SESSION_VERSION = 6;

const session = createHmrPersistentState<YeastRuntimeSession>('yeast.runtime', () => ({
    version: YEAST_RUNTIME_SESSION_VERSION,
    context: null,
    node: null,
    nodePromise: null,
    projection: [],
    processTail: Promise.resolve(),
    generation: 0,
    projectionRevision: 0,
    appliedProjectionRevision: 0,
    status: 'uninitialized',
    error: undefined,
    onNotesOff: null,
    pendingNotesOff: [],
    onOutputPanic: null,
    pendingOutputPanic: false,
    pendingAllNotesOff: null,
    activeOutputNotes: new Map(),
}));

// Retained pre-v6 sessions use the pitch-only host note-off contract. Revoke
// every runtime handle and defer channel-complete settlement to the new sink.
if (session.version !== YEAST_RUNTIME_SESSION_VERSION) {
    const staleNode = session.node;
    const retainedRuntimeMayOwnOutput = session.context !== null || session.nodePromise !== null || staleNode !== null;
    const pendingNotesOff = collectActiveOutputNotes(session.generation);
    const hadActiveOutputNotes = pendingNotesOff.length > 0;
    session.version = YEAST_RUNTIME_SESSION_VERSION;
    session.generation =
        Number.isSafeInteger(session.generation) && session.generation < Number.MAX_SAFE_INTEGER
            ? session.generation + 1
            : 1;
    session.context = null;
    session.node = null;
    session.nodePromise = null;
    session.processTail = Promise.resolve();
    session.projectionRevision = 0;
    session.appliedProjectionRevision = 0;
    session.status = 'uninitialized';
    session.error = undefined;
    session.onNotesOff = null;
    session.pendingNotesOff = pendingNotesOff;
    session.onOutputPanic = null;
    session.pendingOutputPanic = retainedRuntimeMayOwnOutput || hadActiveOutputNotes;
    session.pendingAllNotesOff = null;
    session.activeOutputNotes = new Map();
    if (staleNode) {
        try {
            staleNode.destroy();
        } catch (error: unknown) {
            logger.warn('[Yeast] Stale HMR runtime destroy failed:', error);
        }
    }
}

function cloneProjection(projection: readonly YeastProcessorProjectionItem[]): YeastProcessorProjection {
    return projection.map((processor) => ({
        ...processor,
        params: { ...processor.params },
    }));
}

type ProjectionRecord = {
    projection: YeastProcessorProjection;
    revision: number;
};

function projectionsEqual(
    current: readonly YeastProcessorProjectionItem[],
    next: readonly YeastProcessorProjectionItem[]
): boolean {
    if (current.length !== next.length) {
        return false;
    }
    for (let index = 0; index < current.length; index++) {
        const currentProcessor = current[index]!;
        const nextProcessor = next[index]!;
        if (
            currentProcessor.id !== nextProcessor.id ||
            currentProcessor.type !== nextProcessor.type ||
            currentProcessor.bypassed !== nextProcessor.bypassed
        ) {
            return false;
        }

        const currentParams = currentProcessor.params;
        const nextParams = nextProcessor.params;
        const currentParamNames = Object.keys(currentParams);
        const nextParamNames = Object.keys(nextParams);
        if (currentParamNames.length !== nextParamNames.length) {
            return false;
        }
        for (const name of currentParamNames) {
            if (currentParams[name] !== nextParams[name]) {
                return false;
            }
        }
    }
    return true;
}

function recordProjection(projection: readonly YeastProcessorProjectionItem[]): ProjectionRecord {
    if (projectionsEqual(session.projection, projection)) {
        return { projection: session.projection, revision: session.projectionRevision };
    }

    const nextProjection = cloneProjection(projection);
    session.projection = nextProjection;
    session.projectionRevision += 1;
    return { projection: nextProjection, revision: session.projectionRevision };
}

function isLiveRuntime(node: YeastWorkerResult, generation: number): boolean {
    return session.node === node && session.generation === generation;
}

function activeOutputNoteKey(trackId: string, channel: number, note: number, noteInstanceId?: string): string {
    return noteInstanceId
        ? `${trackId}\u0000instance\u0000${noteInstanceId}`
        : `${trackId}\u0000legacy\u0000${channel}\u0000${note}`;
}

function emitNotesOff(notesOff: YeastNotesOffPayload[]): void {
    if (notesOff.length === 0) {
        return;
    }
    const handler = session.onNotesOff;
    if (!handler) {
        session.pendingNotesOff.push(...notesOff);
        return;
    }
    try {
        handler(notesOff);
    } catch (error: unknown) {
        logger.warn('[Yeast] Host note-off settlement failed:', error);
    }
}

function flushPendingNotesOff(): void {
    const handler = session.onNotesOff;
    if (!handler || session.pendingNotesOff.length === 0) {
        return;
    }
    const pendingNotesOff = session.pendingNotesOff;
    session.pendingNotesOff = [];
    try {
        handler(pendingNotesOff);
    } catch (error: unknown) {
        logger.warn('[Yeast] Deferred host note-off settlement failed:', error);
    }
}

function collectActiveOutputNotes(generation: number): YeastNotesOffPayload[] {
    const activeOutputNotes = session.activeOutputNotes;
    if (!(activeOutputNotes instanceof Map) || activeOutputNotes.size === 0) {
        session.activeOutputNotes = new Map();
        return [];
    }

    const notesByTrack = new Map<string, YeastNotesOffPayload['noteOffs']>();
    for (const activeNote of activeOutputNotes.values()) {
        if (activeNote.generation !== generation) {
            continue;
        }
        const notes = notesByTrack.get(activeNote.trackId) ?? [];
        notes.push({
            channel: activeNote.channel,
            note: activeNote.note,
            noteInstanceId: activeNote.noteInstanceId,
        });
        notesByTrack.set(activeNote.trackId, notes);
    }
    session.activeOutputNotes = new Map();
    return [...notesByTrack].map(([trackId, noteOffs]) => ({ trackId, noteOffs }));
}

function settleActiveOutputNotes(generation: number): boolean {
    const notesOff = collectActiveOutputNotes(generation);
    emitNotesOff(notesOff);
    return notesOff.length > 0;
}

function flushPendingOutputPanic(): void {
    if (!session.pendingOutputPanic || !session.onOutputPanic) {
        return;
    }
    const onOutputPanic = session.onOutputPanic;
    session.pendingOutputPanic = false;
    try {
        onOutputPanic();
    } catch (error: unknown) {
        logger.warn('[Yeast] Host output panic failed:', error);
    }
}

function requestOutputPanic(): void {
    session.pendingOutputPanic = true;
    flushPendingOutputPanic();
}

function settleRuntimeOutputNotes(generation: number): void {
    if (settleActiveOutputNotes(generation)) {
        requestOutputPanic();
    }
}

function recordAcceptedOutputNotes(events: readonly MidiEvent[], generation: number, fallbackTrackId: string): void {
    if (session.generation !== generation) {
        return;
    }
    for (const event of events) {
        if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
            continue;
        }
        const trackId = event.trackId ?? fallbackTrackId;
        const key = activeOutputNoteKey(trackId, event.kind.channel, event.kind.note, event.noteInstanceId);
        if (event.kind.type === 'noteOn' && event.kind.velocity > 0) {
            session.activeOutputNotes.set(key, {
                generation,
                trackId,
                channel: event.kind.channel,
                note: event.kind.note,
                noteInstanceId: event.noteInstanceId,
            });
        } else {
            session.activeOutputNotes.delete(key);
        }
    }
}

function recordWorkerNotesOff(notesOff: readonly YeastNotesOffPayload[], generation: number): void {
    if (session.generation !== generation) {
        return;
    }
    for (const payload of notesOff) {
        for (const noteOff of payload.noteOffs) {
            const key = activeOutputNoteKey(payload.trackId, noteOff.channel, noteOff.note, noteOff.noteInstanceId);
            const activeNote = session.activeOutputNotes.get(key);
            if (activeNote?.generation === generation) {
                session.activeOutputNotes.delete(key);
            }
        }
    }
}

function prepareRuntimeContext(context: BaseAudioContext): void {
    if (session.context !== null && session.context !== context) {
        const previousNode = session.node;
        if (previousNode) {
            invalidateCurrentRuntime(previousNode);
        } else {
            settleRuntimeOutputNotes(session.generation);
            session.generation += 1;
            session.processTail = Promise.resolve();
            session.appliedProjectionRevision = 0;
        }
        session.pendingAllNotesOff = null;
        destroyCurrentNode();
        session.nodePromise = null;
        session.status = 'uninitialized';
        session.error = undefined;
    }

    session.context = context;
}

function enqueueRuntimeOperation<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    const next = session.processTail.then(operation, operation);
    session.processTail = next.then(
        () => undefined,
        () => undefined
    );
    return next;
}

function setRuntimeUnavailable(error: unknown): void {
    session.status = 'unavailable';
    session.error = error instanceof Error ? error.message : String(error);
}

function destroyCurrentNode(): void {
    const node = session.node;
    session.node = null;
    if (node) {
        try {
            node.destroy();
        } catch (error: unknown) {
            logger.warn('[Yeast] Worker runtime destroy failed:', error);
        }
    }
}

function invalidateCurrentRuntime(node: YeastWorkerResult): boolean {
    if (session.node !== node) {
        return false;
    }
    settleRuntimeOutputNotes(session.generation);
    session.generation += 1;
    destroyCurrentNode();
    session.nodePromise = null;
    session.processTail = Promise.resolve();
    session.appliedProjectionRevision = 0;
    session.pendingAllNotesOff = null;
    return true;
}

function failCurrentRuntime(node: YeastWorkerResult, error: unknown): void {
    if (session.node !== node) {
        return;
    }
    invalidateCurrentRuntime(node);
    setRuntimeUnavailable(error);
}

async function trySendAllNotesOff(node: YeastWorkerResult, nowSamples: number, generation: number): Promise<boolean> {
    try {
        await node.allNotesOff(nowSamples);
        if (!isLiveRuntime(node, generation)) {
            return false;
        }
        return true;
    } catch (error: unknown) {
        if (isLiveRuntime(node, generation)) {
            failCurrentRuntime(node, error);
        }
        return false;
    }
}

export async function applyYeastRuntimeProjection(projection: readonly YeastProcessorProjectionItem[]): Promise<void> {
    const record = recordProjection(projection);
    const initialNode = session.node;
    const initialGeneration = session.generation;
    const initialization = session.nodePromise;
    await enqueueRuntimeOperation(async () => {
        if (session.generation !== initialGeneration) {
            throw new Error('Yeast Worker projection generation changed');
        }

        let node = initialNode;
        if (initialization) {
            await initialization;
            if (session.generation !== initialGeneration) {
                throw new Error('Yeast Worker projection generation changed');
            }
            node = initialNode ?? session.node;
        }
        if (!node || !isLiveRuntime(node, initialGeneration)) {
            return;
        }

        if (session.appliedProjectionRevision === record.revision) {
            return;
        }
        try {
            await node.setProjection(record.projection);
        } catch (error: unknown) {
            if (isLiveRuntime(node, initialGeneration)) {
                failCurrentRuntime(node, error);
            }
            throw error;
        }
        if (!isLiveRuntime(node, initialGeneration)) {
            throw new Error('Yeast Worker projection generation changed');
        }
        session.appliedProjectionRevision = record.revision;
    });
}

/**
 * Preserve the existing fire-and-forget caller contract while ensuring a
 * dynamic projection failure still invalidates the runtime and publishes its
 * error through the runtime status path.
 */
export function setYeastRuntimeProjection(projection: readonly YeastProcessorProjectionItem[]): void {
    void applyYeastRuntimeProjection(projection).catch((error: unknown) => {
        logger.warn('[Yeast] Dynamic projection update failed:', error);
    });
}

type YeastRuntimeCommandResult =
    | { delivered: true }
    | { delivered: false; reason: 'runtime-unavailable' | 'delivery-failed' };

/**
 * Commands are delivered only to the ready node; they are never retained for
 * projection replay or retried after an uncertain delivery.
 */
export async function sendYeastRuntimeCommand(command: YeastProcessorCommand): Promise<YeastRuntimeCommandResult> {
    const node = session.node;
    if (!node || session.status !== 'ready' || session.nodePromise) {
        return { delivered: false, reason: 'runtime-unavailable' };
    }
    const generation = session.generation;

    try {
        const ack = await enqueueRuntimeOperation(async () => {
            if (!isLiveRuntime(node, generation)) {
                throw new Error('Yeast Worker runtime generation changed');
            }
            return node.sendCommand(command);
        });
        if (!isLiveRuntime(node, generation) || !ack.accepted) {
            return { delivered: false, reason: 'delivery-failed' };
        }
        return { delivered: true };
    } catch (error: unknown) {
        if (session.node === node && session.generation === generation) {
            failCurrentRuntime(node, error);
        }
        return { delivered: false, reason: 'delivery-failed' };
    }
}

async function ensureYeastRuntimeInternal(
    input: {
        context: BaseAudioContext;
        projection: readonly YeastProcessorProjectionItem[];
    },
    initializationProjection?: ProjectionRecord
): Promise<YeastWorkerResult | null> {
    prepareRuntimeContext(input.context);
    if (session.nodePromise) {
        return session.nodePromise;
    }
    if (session.node) {
        return session.node;
    }

    const generation = session.generation;
    session.status = 'initializing';
    session.error = undefined;

    const nodePromise = createYeastWorker(input.context)
        .then(async (node) => {
            if (session.generation !== generation || session.context !== input.context) {
                try {
                    node.destroy();
                } catch (error: unknown) {
                    logger.warn('[Yeast] Stale Worker runtime destroy failed:', error);
                }
                return null;
            }
            session.node = node;
            node.onTerminalError((error) => {
                if (isLiveRuntime(node, generation)) {
                    failCurrentRuntime(node, error);
                }
            });
            if (!isLiveRuntime(node, generation)) {
                return null;
            }
            node.onNotesOff((notes) => {
                if (!isLiveRuntime(node, generation)) {
                    return;
                }
                recordWorkerNotesOff(notes, generation);
                emitNotesOff(notes);
            });
            try {
                const projectionToApply = initializationProjection ?? {
                    projection: session.projection,
                    revision: session.projectionRevision,
                };
                await node.setProjection(projectionToApply.projection);
                session.appliedProjectionRevision = projectionToApply.revision;
            } catch (error: unknown) {
                if (session.node === node && session.generation === generation) {
                    failCurrentRuntime(node, error);
                }
                return null;
            }
            if (session.node !== node || session.generation !== generation || session.context !== input.context) {
                try {
                    node.destroy();
                } catch (error: unknown) {
                    logger.warn('[Yeast] Stale Worker runtime destroy failed:', error);
                }
                return null;
            }
            const pendingAllNotesOff = session.pendingAllNotesOff;
            session.pendingAllNotesOff = null;
            if (
                pendingAllNotesOff &&
                pendingAllNotesOff.context === input.context &&
                pendingAllNotesOff.generation === generation
            ) {
                if (!(await trySendAllNotesOff(node, pendingAllNotesOff.nowSamples, generation))) {
                    return null;
                }
            }
            session.status = 'ready';
            session.error = undefined;
            if (session.nodePromise === nodePromise) {
                session.nodePromise = null;
            }
            return node;
        })
        .catch((error: unknown) => {
            if (session.generation === generation && session.context === input.context) {
                const currentNode = session.node;
                if (currentNode) {
                    failCurrentRuntime(currentNode, error);
                } else {
                    destroyCurrentNode();
                }
                if (session.nodePromise === nodePromise) {
                    session.nodePromise = null;
                }
                setRuntimeUnavailable(error);
                logger.warn('[Yeast] Worker runtime unavailable:', error);
            }
            return null;
        });

    session.nodePromise = nodePromise;
    return nodePromise;
}

export async function ensureYeastRuntime(input: {
    context: BaseAudioContext;
    projection: readonly YeastProcessorProjectionItem[];
}): Promise<YeastWorkerResult | null> {
    recordProjection(input.projection);
    return ensureYeastRuntimeInternal(input);
}

export async function processYeastRuntimeBlock(input: ProcessYeastRuntimeBlockInput): Promise<MidiEvent[] | null> {
    const node = session.node;
    if (!node || session.status !== 'ready' || session.nodePromise || node.context !== input.context) {
        return null;
    }

    const generation = session.generation;
    try {
        return await enqueueRuntimeOperation(async () => {
            if (!isLiveRuntime(node, generation)) {
                throw new Error('Yeast Worker runtime changed during MIDI processing');
            }
            const processedEvents = await node.processBlock(
                input.events,
                input.blockStartSamples,
                input.blockEndSamples,
                input.transport,
                input.trackId
            );
            if (!isLiveRuntime(node, generation)) {
                throw new Error('Yeast Worker runtime changed during MIDI processing');
            }
            recordAcceptedOutputNotes(processedEvents, generation, input.trackId);
            return processedEvents;
        });
    } catch (error: unknown) {
        if (isLiveRuntime(node, generation)) {
            failCurrentRuntime(node, error);
        }
        throw error;
    }
}

export async function processYeastRuntimeTransaction(
    input: ProcessYeastRuntimeTransactionInput
): Promise<MidiEvent[] | null> {
    const record = recordProjection(input.projection);
    prepareRuntimeContext(input.context);
    const transactionGeneration = session.generation;

    return enqueueRuntimeOperation(async () => {
        if (session.generation !== transactionGeneration || session.context !== input.context) {
            return null;
        }
        const node = await ensureYeastRuntimeInternal(
            { context: input.context, projection: record.projection },
            record
        );
        if (!node || node.context !== input.context) {
            return null;
        }

        const generation = session.generation;
        if (!isLiveRuntime(node, generation)) {
            throw new Error('Yeast Worker runtime changed during MIDI processing');
        }

        try {
            if (session.appliedProjectionRevision !== record.revision) {
                await node.setProjection(record.projection);
                if (!isLiveRuntime(node, generation)) {
                    throw new Error('Yeast Worker projection generation changed');
                }
                session.appliedProjectionRevision = record.revision;
            }

            const processedEvents = await node.processBlock(
                input.events,
                input.blockStartSamples,
                input.blockEndSamples,
                input.transport,
                input.trackId
            );
            if (!isLiveRuntime(node, generation)) {
                throw new Error('Yeast Worker runtime changed during MIDI processing');
            }
            recordAcceptedOutputNotes(processedEvents, generation, input.trackId);
            return processedEvents;
        } catch (error: unknown) {
            if (isLiveRuntime(node, generation)) {
                failCurrentRuntime(node, error);
            }
            throw error;
        }
    });
}

export async function sendYeastRuntimeAllNotesOff(nowSamples: number): Promise<void> {
    const node = session.node;
    if (!node || session.status !== 'ready' || session.nodePromise) {
        if (session.context === null) {
            // There is no context to scope this panic to yet, so do not retain it.
            return;
        }
        // Panic is idempotent; keep only the latest request during initialization.
        session.pendingAllNotesOff = {
            context: session.context,
            generation: session.generation,
            nowSamples,
        };
        return;
    }

    const generation = session.generation;
    try {
        await enqueueRuntimeOperation(async () => {
            if (!isLiveRuntime(node, generation)) {
                throw new Error('Yeast Worker runtime generation changed');
            }
            await trySendAllNotesOff(node, nowSamples, generation);
        });
    } catch (error: unknown) {
        if (isLiveRuntime(node, generation)) {
            failCurrentRuntime(node, error);
        }
    }
}

export function setYeastRuntimeNotesOffHandler(handler: (notesOff: YeastNotesOffPayload[]) => void): void {
    session.onNotesOff = handler;
    flushPendingNotesOff();
}

export function setYeastRuntimeOutputPanicHandler(handler: () => void): void {
    session.onOutputPanic = handler;
    flushPendingOutputPanic();
}

export function destroyYeastRuntime(): void {
    if (
        session.context === null &&
        session.node === null &&
        session.nodePromise === null &&
        session.activeOutputNotes.size === 0
    ) {
        return;
    }

    const node = session.node;
    if (node) {
        invalidateCurrentRuntime(node);
    } else {
        settleRuntimeOutputNotes(session.generation);
        session.generation += 1;
        session.nodePromise = null;
        session.processTail = Promise.resolve();
        session.appliedProjectionRevision = 0;
        session.pendingAllNotesOff = null;
    }
    session.context = null;
    session.status = 'uninitialized';
    session.error = undefined;
}

export function getYeastRuntimeStatus(): YeastRuntimeStatus {
    return session.status;
}

export function getYeastRuntimeError(): string | undefined {
    return session.error;
}
