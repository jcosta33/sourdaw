import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastNotesOffPayload } from '../../events/YeastNotesOffPayload';
import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';
import type { YeastProcessorCommand } from '../../models/YeastProcessorCommand';
import type { YeastProcessorProjection } from '../../models/YeastProcessorProjection';

const createWorker = vi.hoisted(() => vi.fn());
const retainedHmrState = vi.hoisted((): { value: unknown } => ({ value: undefined }));

vi.mock('../YeastWorkerClient', () => ({
    createYeastWorker: createWorker,
}));

vi.mock('#/utils/HMR/createHmrPersistentState', () => ({
    createHmrPersistentState: (_key: string, factory: () => unknown) => retainedHmrState.value ?? factory(),
}));

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

type LegacyWorkletNode = {
    context: BaseAudioContext;
    processBlock: (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo,
        trackId: string
    ) => Promise<MidiEvent[]>;
    sendCommand: (command: YeastProcessorCommand) => Promise<{ accepted: boolean }>;
    setProjection: (projection: YeastProcessorProjection) => Promise<void>;
    allNotesOff: (nowSamples: number) => Promise<void>;
    onNotesOff: (handler: (notesOff: YeastNotesOffPayload[]) => void) => () => void;
    destroy: ReturnType<typeof vi.fn>;
};

type LegacyRuntimeSession = {
    version: number;
    context: BaseAudioContext | null;
    node: LegacyWorkletNode | null;
    nodePromise: Promise<LegacyWorkletNode | null> | null;
    projection: YeastProcessorProjection;
    processTail: Promise<void>;
    generation: number;
    projectionRevision: number;
    appliedProjectionRevision: number;
    status: 'uninitialized' | 'initializing' | 'ready' | 'unavailable';
    error: string | undefined;
    onNotesOff: ((notesOff: YeastNotesOffPayload[]) => void) | null;
    pendingNotesOff?: YeastNotesOffPayload[];
    pendingAllNotesOff: { context: BaseAudioContext; generation: number; nowSamples: number } | null;
    activeOutputNotes?: Map<string, { generation: number; trackId: string; channel: number; note: number }>;
};

function deferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

function makeLegacyNode(context: BaseAudioContext): LegacyWorkletNode {
    return {
        context,
        processBlock: vi.fn(() => Promise.resolve([])),
        sendCommand: vi.fn(() => Promise.resolve({ accepted: true })),
        setProjection: vi.fn(() => Promise.resolve()),
        allNotesOff: vi.fn(() => Promise.resolve()),
        onNotesOff: vi.fn(() => () => {}),
        destroy: vi.fn(),
    };
}

function makeWorker(context: BaseAudioContext) {
    return {
        context,
        processBlock: vi.fn(() => Promise.resolve([])),
        sendCommand: vi.fn(() => Promise.resolve({ accepted: true })),
        setProjection: vi.fn(() => Promise.resolve()),
        allNotesOff: vi.fn(() => Promise.resolve()),
        onNotesOff: vi.fn(() => () => {}),
        onTerminalError: vi.fn(() => () => {}),
        destroy: vi.fn(),
    };
}

describe('yeastRuntime HMR migration', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        retainedHmrState.value = undefined;
    });

    it('revokes a retained Worklet generation without losing its serializable projection', async () => {
        const oldContext = {} as BaseAudioContext;
        const newContext = {} as BaseAudioContext;
        const oldNode = makeLegacyNode(oldContext);
        const stalePendingNode = makeLegacyNode(oldContext);
        const pendingNode = deferred<LegacyWorkletNode>();
        const projection: YeastProcessorProjection = [
            { id: 'arp-1', type: 'arpeggiator', bypassed: false, params: { rate_denom: 16 } },
        ];
        const onNotesOff = vi.fn();
        const oldProcessTail = Promise.resolve();
        const oldGeneration = 7;
        let legacySession!: LegacyRuntimeSession;
        const oldNodePromise = pendingNode.promise.then((node) => {
            if (legacySession.generation !== oldGeneration || legacySession.context !== oldContext) {
                node.destroy();
                return null;
            }
            legacySession.node = node;
            return node;
        });
        legacySession = {
            version: 3,
            context: oldContext,
            node: oldNode,
            nodePromise: oldNodePromise,
            projection,
            processTail: oldProcessTail,
            generation: oldGeneration,
            projectionRevision: 4,
            appliedProjectionRevision: 4,
            status: 'ready',
            error: 'stale Worklet error',
            onNotesOff,
            pendingAllNotesOff: { context: oldContext, generation: oldGeneration, nowSamples: 512 },
        };
        retainedHmrState.value = legacySession;

        const runtime = await import('../yeastRuntime');
        const panicOutputNotes = vi.fn();

        expect(legacySession.version).toBe(6);
        expect(legacySession.generation).toBe(oldGeneration + 1);
        expect(oldNode.destroy).toHaveBeenCalledTimes(1);
        expect(legacySession.context).toBeNull();
        expect(legacySession.node).toBeNull();
        expect(legacySession.nodePromise).toBeNull();
        expect(legacySession.processTail).not.toBe(oldProcessTail);
        expect(legacySession.projection).toBe(projection);
        expect(legacySession.projectionRevision).toBe(0);
        expect(legacySession.appliedProjectionRevision).toBe(0);
        expect(legacySession.status).toBe('uninitialized');
        expect(legacySession.error).toBeUndefined();
        expect(legacySession.onNotesOff).toBeNull();
        expect(legacySession.pendingNotesOff).toEqual([]);
        expect(legacySession.pendingAllNotesOff).toBeNull();
        expect(legacySession.activeOutputNotes).toEqual(new Map());
        expect(onNotesOff).not.toHaveBeenCalled();

        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);

        expect(panicOutputNotes).toHaveBeenCalledTimes(1);

        const worker = makeWorker(newContext);
        createWorker.mockResolvedValueOnce(worker);
        await expect(runtime.ensureYeastRuntime({ context: newContext, projection })).resolves.toBe(worker);

        pendingNode.resolve(stalePendingNode);
        await oldNodePromise;

        expect(createWorker).toHaveBeenCalledTimes(1);
        expect(worker.setProjection).toHaveBeenCalledWith(projection);
        expect(stalePendingNode.destroy).toHaveBeenCalledTimes(1);
        expect(legacySession.node).toBe(worker);
        expect(oldNode.processBlock).not.toHaveBeenCalled();
        expect(stalePendingNode.processBlock).not.toHaveBeenCalled();
    });

    it('defers retained v5 Worker output notes until the channel-complete sink is installed', async () => {
        const context = {} as BaseAudioContext;
        const worker = makeWorker(context);
        const onNotesOff = vi.fn();
        const generation = 11;
        const projection: YeastProcessorProjection = [
            { id: 'arp-1', type: 'arpeggiator', bypassed: false, params: { rate_denom: 16 } },
        ];
        const retainedSession: LegacyRuntimeSession = {
            version: 5,
            context,
            node: worker,
            nodePromise: null,
            projection,
            processTail: Promise.resolve(),
            generation,
            projectionRevision: 2,
            appliedProjectionRevision: 2,
            status: 'ready',
            error: undefined,
            onNotesOff,
            pendingAllNotesOff: null,
            activeOutputNotes: new Map([
                ['track-a:2:67', { generation, trackId: 'track-a', channel: 2, note: 67 }],
                ['track-a:3:67', { generation, trackId: 'track-a', channel: 3, note: 67 }],
            ]),
        };
        retainedHmrState.value = retainedSession;

        const runtime = await import('../yeastRuntime');
        const panicOutputNotes = vi.fn();

        expect(retainedSession.version).toBe(6);
        expect(retainedSession.generation).toBe(generation + 1);
        expect(retainedSession.projection).toBe(projection);
        expect(retainedSession.activeOutputNotes).toEqual(new Map());
        expect(onNotesOff).not.toHaveBeenCalled();
        const channelCompleteNotesOff = vi.fn();
        runtime.setYeastRuntimeNotesOffHandler(channelCompleteNotesOff);
        runtime.setYeastRuntimeNotesOffHandler(channelCompleteNotesOff);

        expect(channelCompleteNotesOff).toHaveBeenCalledTimes(1);
        expect(channelCompleteNotesOff).toHaveBeenCalledWith([
            {
                trackId: 'track-a',
                noteOffs: [
                    { channel: 2, note: 67 },
                    { channel: 3, note: 67 },
                ],
            },
        ]);
        expect(retainedSession.pendingNotesOff).toEqual([]);
        expect(worker.destroy).toHaveBeenCalledTimes(1);

        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);

        expect(panicOutputNotes).toHaveBeenCalledTimes(1);
    });
});
