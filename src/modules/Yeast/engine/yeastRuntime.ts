import { logger } from '#/infra/logger/appLogger';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { createYeastWorkletNode, type YeastWorkletNodeResult } from './YeastWorkletNode';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type {
    YeastProcessorProjection,
    YeastProcessorProjectionItem,
    YeastRuntimeStatus,
} from '../models/YeastProcessorProjection';

type ProcessYeastRuntimeBlockInput = {
    context: BaseAudioContext;
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
    node: YeastWorkletNodeResult | null;
    nodePromise: Promise<YeastWorkletNodeResult | null> | null;
    projection: YeastProcessorProjection;
    processTail: Promise<void>;
    generation: number;
    projectionRevision: number;
    appliedProjectionRevision: number;
    status: YeastRuntimeStatus;
    error: string | undefined;
    onNotesOff: ((notes: number[]) => void) | null;
    pendingAllNotesOff: PendingAllNotesOff | null;
};

type PendingAllNotesOff = {
    context: BaseAudioContext;
    generation: number;
    nowSamples: number;
};

const YEAST_RUNTIME_SESSION_VERSION = 3;
const MIDI_PANIC_NOTES = Array.from({ length: 128 }, (_, note) => note);
const fallbackReleasedNodes = new WeakSet<YeastWorkletNodeResult>();

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
    pendingAllNotesOff: null,
}));

// HMR retains the live node/session, but an older module may have left an
// unscoped panic array behind. Drop only that incompatible transient state.
if (session.version !== YEAST_RUNTIME_SESSION_VERSION) {
    session.version = YEAST_RUNTIME_SESSION_VERSION;
    session.processTail = Promise.resolve();
    session.projectionRevision = 0;
    session.appliedProjectionRevision = 0;
    session.pendingAllNotesOff = null;
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

function recordProjection(projection: readonly YeastProcessorProjectionItem[]): ProjectionRecord {
    const nextProjection = cloneProjection(projection);
    session.projection = nextProjection;
    session.projectionRevision += 1;
    return { projection: nextProjection, revision: session.projectionRevision };
}

function isLiveRuntime(node: YeastWorkletNodeResult, generation: number): boolean {
    return session.node === node && session.generation === generation;
}

function prepareRuntimeContext(context: BaseAudioContext): void {
    if (session.context !== null && session.context !== context) {
        const previousNode = session.node;
        if (previousNode) {
            invalidateCurrentRuntime(previousNode);
        } else {
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
            logger.warn('[Yeast] AudioWorklet runtime destroy failed:', error);
        }
    }
}

function invalidateCurrentRuntime(node: YeastWorkletNodeResult): boolean {
    if (session.node !== node) {
        return false;
    }
    session.generation += 1;
    destroyCurrentNode();
    session.nodePromise = null;
    session.processTail = Promise.resolve();
    session.appliedProjectionRevision = 0;
    session.pendingAllNotesOff = null;
    return true;
}

function invokeNotesOffFallback(node: YeastWorkletNodeResult): void {
    if (fallbackReleasedNodes.has(node)) {
        return;
    }
    fallbackReleasedNodes.add(node);

    const handler = session.onNotesOff;
    if (!handler) {
        return;
    }

    try {
        handler([...MIDI_PANIC_NOTES]);
    } catch (error: unknown) {
        logger.warn('[Yeast] Panic Note Off fallback failed:', error);
    }
}

function failCurrentRuntime(node: YeastWorkletNodeResult, error: unknown): void {
    if (session.node !== node) {
        return;
    }
    invokeNotesOffFallback(node);
    invalidateCurrentRuntime(node);
    setRuntimeUnavailable(error);
}

async function trySendAllNotesOff(
    node: YeastWorkletNodeResult,
    nowSamples: number,
    generation: number
): Promise<boolean> {
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
            throw new Error('Yeast AudioWorklet projection generation changed');
        }

        let node = initialNode;
        if (initialization) {
            await initialization;
            if (session.generation !== initialGeneration) {
                throw new Error('Yeast AudioWorklet projection generation changed');
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
            throw new Error('Yeast AudioWorklet projection generation changed');
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
                throw new Error('Yeast AudioWorklet runtime generation changed');
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
): Promise<YeastWorkletNodeResult | null> {
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

    const nodePromise = createYeastWorkletNode(input.context)
        .then(async (node) => {
            if (session.generation !== generation || session.context !== input.context) {
                try {
                    node.destroy();
                } catch (error: unknown) {
                    logger.warn('[Yeast] Stale AudioWorklet runtime destroy failed:', error);
                }
                return null;
            }
            session.node = node;
            node.onNotesOff((notes) => {
                session.onNotesOff?.(notes);
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
                    logger.warn('[Yeast] Stale AudioWorklet runtime destroy failed:', error);
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
                logger.warn('[Yeast] AudioWorklet runtime unavailable:', error);
            }
            return null;
        });

    session.nodePromise = nodePromise;
    return nodePromise;
}

export async function ensureYeastRuntime(input: {
    context: BaseAudioContext;
    projection: readonly YeastProcessorProjectionItem[];
}): Promise<YeastWorkletNodeResult | null> {
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
                throw new Error('Yeast AudioWorklet runtime changed during MIDI processing');
            }
            const processedEvents = await node.processBlock(
                input.events,
                input.blockStartSamples,
                input.blockEndSamples,
                input.transport
            );
            if (!isLiveRuntime(node, generation)) {
                throw new Error('Yeast AudioWorklet runtime changed during MIDI processing');
            }
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
            throw new Error('Yeast AudioWorklet runtime changed during MIDI processing');
        }

        try {
            if (session.appliedProjectionRevision !== record.revision) {
                await node.setProjection(record.projection);
                if (!isLiveRuntime(node, generation)) {
                    throw new Error('Yeast AudioWorklet projection generation changed');
                }
                session.appliedProjectionRevision = record.revision;
            }

            const processedEvents = await node.processBlock(
                input.events,
                input.blockStartSamples,
                input.blockEndSamples,
                input.transport
            );
            if (!isLiveRuntime(node, generation)) {
                throw new Error('Yeast AudioWorklet runtime changed during MIDI processing');
            }
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
                throw new Error('Yeast AudioWorklet runtime generation changed');
            }
            await trySendAllNotesOff(node, nowSamples, generation);
        });
    } catch (error: unknown) {
        if (isLiveRuntime(node, generation)) {
            failCurrentRuntime(node, error);
        }
    }
}

export function setYeastRuntimeNotesOffHandler(handler: (notes: number[]) => void): void {
    session.onNotesOff = handler;
}

export function getYeastRuntimeStatus(): YeastRuntimeStatus {
    return session.status;
}

export function getYeastRuntimeError(): string | undefined {
    return session.error;
}
