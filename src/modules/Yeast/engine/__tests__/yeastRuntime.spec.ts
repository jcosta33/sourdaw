import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastNotesOffPayload } from '../../events/YeastNotesOffPayload';
import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';
import type { YeastProcessorCommand } from '../../models/YeastProcessorCommand';
import type { YeastProcessorProjection } from '../../models/YeastProcessorProjection';
import type { YeastWorkerResult } from '../YeastWorkerClient';

const createNode = vi.hoisted(() => vi.fn());

vi.mock('../YeastWorkerClient', () => ({
    createYeastWorker: createNode,
}));

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
};

type RuntimeBlockInput = {
    context: BaseAudioContext;
    trackId: string;
    projection: YeastProcessorProjection;
    events: readonly MidiEvent[];
    blockStartSamples: number;
    blockEndSamples: number;
    transport: TransportInfo;
};

type RuntimeWithTransaction = typeof import('../yeastRuntime') & {
    processYeastRuntimeTransaction: (input: RuntimeBlockInput) => Promise<MidiEvent[] | null>;
};

function deferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    let rejectDeferred!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });
    return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

async function flushRuntimeQueue(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function makeNode(context: BaseAudioContext) {
    let terminalErrorHandler: ((error: Error) => void) | null = null;
    let notesOffHandler: ((notesOff: YeastNotesOffPayload[]) => void) | null = null;
    return {
        context,
        processBlock: vi.fn(
            (_events: readonly MidiEvent[], _blockStart: number, _blockEnd: number, _transport: TransportInfo) =>
                Promise.resolve([])
        ),
        setProjection: vi.fn(),
        sendCommand: vi.fn(() => Promise.resolve({ accepted: true })),
        allNotesOff: vi.fn(),
        onNotesOff: vi.fn((handler: (notesOff: YeastNotesOffPayload[]) => void) => {
            notesOffHandler = handler;
            return () => {
                if (notesOffHandler === handler) {
                    notesOffHandler = null;
                }
            };
        }),
        onTerminalError: vi.fn((handler: (error: Error) => void) => {
            terminalErrorHandler = handler;
            return () => {
                if (terminalErrorHandler === handler) {
                    terminalErrorHandler = null;
                }
            };
        }),
        emitTerminalError: (error: Error) => {
            terminalErrorHandler?.(error);
        },
        emitNotesOff: (notesOff: YeastNotesOffPayload[]) => {
            notesOffHandler?.(notesOff);
        },
        destroy: vi.fn(),
    };
}

const projectionA: YeastProcessorProjection = [
    { id: 'arp-1', type: 'arpeggiator', bypassed: false, params: { rate_denom: 8 } },
];
const projectionB: YeastProcessorProjection = [
    { id: 'filter-1', type: 'filter', bypassed: true, params: { min_note: 48 } },
];

function makeRuntimeBlockInput(context: BaseAudioContext): RuntimeBlockInput {
    return {
        context,
        trackId: 'track-a',
        projection: projectionA,
        events: [],
        blockStartSamples: 0,
        blockEndSamples: 128,
        transport: {
            bpm: 120,
            isPlaying: true,
            sampleRate: 48000,
            ppqPosition: 0,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        },
    };
}

async function loadRuntime(): Promise<typeof import('../yeastRuntime')> {
    vi.resetModules();
    return import('../yeastRuntime');
}

describe('yeastRuntime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('replays the latest projection when lazy worker initialization resolves', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkerResult>();
        const node = makeNode(context);
        createNode.mockReturnValueOnce(pending.promise);

        runtime.setYeastRuntimeProjection(projectionA);
        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeProjection(projectionB);
        pending.resolve(node);

        await expect(initialization).resolves.toBe(node);
        expect(node.setProjection).toHaveBeenCalledTimes(1);
        expect(node.setProjection).toHaveBeenCalledWith(projectionB);
    });

    it('does not publish ready before projection execution is acknowledged', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pendingProjection = deferred<void>();
        const node = makeNode(context);
        node.setProjection.mockReturnValueOnce(pendingProjection.promise);
        createNode.mockResolvedValueOnce(node);

        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        let settled = false;
        void initialization.then(() => {
            settled = true;
            return undefined;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(settled).toBe(false);
        expect(runtime.getYeastRuntimeStatus()).toBe('initializing');

        pendingProjection.resolve();
        await expect(initialization).resolves.toBe(node);
        expect(runtime.getYeastRuntimeStatus()).toBe('ready');
    });

    it('invalidates the current runtime and releases notes when a dynamic projection rejects', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const onNotesOff = vi.fn();
        const projectionUpdate = deferred<void>();
        const error = new Error('projection acknowledgement failed');
        void projectionUpdate.promise.catch(() => undefined);
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        node.setProjection.mockReturnValueOnce(projectionUpdate.promise);

        runtime.setYeastRuntimeProjection(projectionB);
        projectionUpdate.reject(error);
        await Promise.resolve();
        await Promise.resolve();

        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(onNotesOff).not.toHaveBeenCalled();
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(error.message);
    });

    it('does not emit unscoped notes when projection delivery fails', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const lifecycle: string[] = [];
        const onNotesOff = vi.fn();
        const error = new Error('projection post failed');
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        node.destroy.mockImplementationOnce(() => {
            lifecycle.push('destroy');
        });
        node.setProjection.mockImplementationOnce(() => {
            throw error;
        });

        runtime.setYeastRuntimeProjection(projectionB);
        await flushRuntimeQueue();

        expect(onNotesOff).not.toHaveBeenCalled();
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(lifecycle).toEqual(['destroy']);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(error.message);
    });

    it('discards an old context runtime and replays the current projection to the replacement', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const pendingA = deferred<YeastWorkerResult>();
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        createNode.mockReturnValueOnce(pendingA.promise).mockResolvedValueOnce(nodeB);

        runtime.setYeastRuntimeProjection(projectionA);
        const initializationA = runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        runtime.setYeastRuntimeProjection(projectionB);
        const initializationB = runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });

        pendingA.resolve(nodeA);

        await expect(initializationB).resolves.toBe(nodeB);
        await expect(initializationA).resolves.toBeNull();
        expect(nodeA.destroy).toHaveBeenCalledTimes(1);
        expect(nodeB.setProjection).toHaveBeenCalledWith(projectionB);
    });

    it('invalidates a terminally failed Worker and replaces it through the runtime', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const nodeA = makeNode(context);
        const nodeB = makeNode(context);
        const processed = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 67, velocity: 100 } }];
        nodeB.processBlock.mockResolvedValueOnce(processed);
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await expect(runtime.ensureYeastRuntime({ context, projection: projectionA })).resolves.toBe(nodeA);
        expect(nodeA.onTerminalError).toHaveBeenCalledTimes(1);

        nodeA.emitTerminalError(new Error('Worker crashed'));

        expect(nodeA.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe('Worker crashed');

        const result = await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction({
            context,
            trackId: 'track-a',
            projection: projectionA,
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport: {
                bpm: 120,
                isPlaying: true,
                sampleRate: 48000,
                ppqPosition: 0,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            },
        });

        expect(result).toEqual(processed);
        expect(createNode).toHaveBeenCalledTimes(2);
        expect(nodeB.setProjection).toHaveBeenCalledWith(projectionA);
    });

    it('settles accepted output notes exactly once when the Worker becomes terminal', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const onNotesOff = vi.fn();
        const panicOutputNotes = vi.fn();
        node.processBlock.mockResolvedValueOnce([
            {
                timeSamples: 0,
                trackId: 'track-a',
                kind: { type: 'noteOn' as const, channel: 2, note: 67, velocity: 100 },
            },
        ]);
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
        await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(makeRuntimeBlockInput(context));

        node.emitTerminalError(new Error('Worker crashed'));
        node.emitTerminalError(new Error('duplicate terminal signal'));
        runtime.destroyYeastRuntime();

        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith([{ trackId: 'track-a', notes: [67] }]);
        expect(panicOutputNotes).toHaveBeenCalledTimes(1);
        expect(node.allNotesOff).not.toHaveBeenCalled();
    });

    it('does not settle an output note again after an accepted note-off', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const onNotesOff = vi.fn();
        const panicOutputNotes = vi.fn();
        node.processBlock
            .mockResolvedValueOnce([
                {
                    timeSamples: 0,
                    trackId: 'track-a',
                    kind: { type: 'noteOn' as const, channel: 2, note: 67, velocity: 100 },
                },
            ])
            .mockResolvedValueOnce([
                {
                    timeSamples: 128,
                    trackId: 'track-a',
                    kind: { type: 'noteOff' as const, channel: 2, note: 67 },
                },
            ]);
        createNode.mockResolvedValueOnce(node);
        const input = makeRuntimeBlockInput(context);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
        await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(input);
        await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(input);
        node.emitTerminalError(new Error('Worker crashed after release'));

        expect(onNotesOff).not.toHaveBeenCalled();
        expect(panicOutputNotes).not.toHaveBeenCalled();
    });

    it('settles accepted output notes on explicit runtime teardown without duplicates', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const onNotesOff = vi.fn();
        const panicOutputNotes = vi.fn();
        node.processBlock.mockResolvedValueOnce([
            {
                timeSamples: 0,
                trackId: 'track-a',
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
        ]);
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
        await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(makeRuntimeBlockInput(context));

        runtime.destroyYeastRuntime();
        runtime.destroyYeastRuntime();

        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith([{ trackId: 'track-a', notes: [60] }]);
        expect(panicOutputNotes).toHaveBeenCalledTimes(1);
        expect(node.destroy).toHaveBeenCalledTimes(1);
    });

    it('settles accepted output notes before replacing the AudioContext generation', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        const onNotesOff = vi.fn();
        const panicOutputNotes = vi.fn();
        nodeA.processBlock.mockResolvedValueOnce([
            {
                timeSamples: 0,
                trackId: 'track-a',
                kind: { type: 'noteOn' as const, channel: 3, note: 69, velocity: 100 },
            },
        ]);
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
        await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(makeRuntimeBlockInput(contextA));

        await runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });
        nodeA.emitNotesOff([{ trackId: 'track-a', notes: [69] }]);

        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith([{ trackId: 'track-a', notes: [69] }]);
        expect(panicOutputNotes).toHaveBeenCalledTimes(1);
        expect(nodeA.destroy).toHaveBeenCalledTimes(1);
        expect(nodeB.destroy).not.toHaveBeenCalled();
    });

    it.each(['process', 'projection', 'command', 'panic'] as const)(
        'settles accepted output notes when a %s request times out',
        async (failureKind) => {
            const runtime = await loadRuntime();
            const context = {} as BaseAudioContext;
            const node = makeNode(context);
            const onNotesOff = vi.fn();
            const panicOutputNotes = vi.fn();
            const timeout = new Error(`${failureKind} acknowledgement timed out`);
            const input = makeRuntimeBlockInput(context);
            node.processBlock.mockResolvedValueOnce([
                {
                    timeSamples: 0,
                    trackId: 'track-a',
                    kind: { type: 'noteOn' as const, channel: 1, note: 65, velocity: 100 },
                },
            ]);
            createNode.mockResolvedValueOnce(node);

            await runtime.ensureYeastRuntime({ context, projection: projectionA });
            runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
            runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
            await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(input);

            if (failureKind === 'process') {
                node.processBlock.mockRejectedValueOnce(timeout);
                await expect((runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(input)).rejects.toBe(
                    timeout
                );
            } else if (failureKind === 'projection') {
                node.setProjection.mockRejectedValueOnce(timeout);
                await expect(runtime.applyYeastRuntimeProjection(projectionB)).rejects.toBe(timeout);
            } else if (failureKind === 'command') {
                node.sendCommand.mockRejectedValueOnce(timeout);
                await expect(
                    runtime.sendYeastRuntimeCommand({ processorId: 'arp-1', type: 'chordMemory.learn' })
                ).resolves.toEqual({ delivered: false, reason: 'delivery-failed' });
            } else {
                node.allNotesOff.mockRejectedValueOnce(timeout);
                await expect(runtime.sendYeastRuntimeAllNotesOff(512)).resolves.toBeUndefined();
            }

            expect(onNotesOff).toHaveBeenCalledTimes(1);
            expect(onNotesOff).toHaveBeenCalledWith([{ trackId: 'track-a', notes: [65] }]);
            expect(panicOutputNotes).toHaveBeenCalledTimes(1);
            expect(node.destroy).toHaveBeenCalledTimes(1);
        }
    );

    it('removes host-owned notes after a successful Worker panic so terminal failure cannot release them twice', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const onNotesOff = vi.fn();
        const panicOutputNotes = vi.fn();
        node.processBlock.mockResolvedValueOnce([
            {
                timeSamples: 0,
                trackId: 'track-a',
                kind: { type: 'noteOn' as const, channel: 1, note: 65, velocity: 100 },
            },
        ]);
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        runtime.setYeastRuntimeOutputPanicHandler(panicOutputNotes);
        await (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction(makeRuntimeBlockInput(context));

        node.emitNotesOff([{ trackId: 'track-a', notes: [65] }]);
        node.emitTerminalError(new Error('Worker crashed after panic'));

        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith([{ trackId: 'track-a', notes: [65] }]);
        expect(panicOutputNotes).not.toHaveBeenCalled();
    });

    it('fences a terminally failed panic and never settles notes against its replacement', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const nodeA = makeNode(context);
        const nodeB = makeNode(context);
        const pendingAck = deferred<void>();
        const onNotesOff = vi.fn();
        nodeA.allNotesOff.mockReturnValueOnce(pendingAck.promise);
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        const panic = runtime.sendYeastRuntimeAllNotesOff(512);
        await flushRuntimeQueue();
        expect(nodeA.allNotesOff).toHaveBeenCalledWith(512);

        nodeA.emitTerminalError(new Error('Worker crashed during panic'));
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        await expect(runtime.ensureYeastRuntime({ context, projection: projectionA })).resolves.toBe(nodeB);

        pendingAck.reject(new Error('Worker crashed during panic'));
        await expect(panic).resolves.toBeUndefined();

        expect(onNotesOff).not.toHaveBeenCalled();
        expect(nodeB.allNotesOff).not.toHaveBeenCalled();
        expect(nodeB.destroy).not.toHaveBeenCalled();
        expect(runtime.getYeastRuntimeStatus()).toBe('ready');
    });

    it('discards a panic queued for context A when context B replaces its generation', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const pendingA = deferred<YeastWorkerResult>();
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        createNode.mockReturnValueOnce(pendingA.promise).mockResolvedValueOnce(nodeB);

        const initializationA = runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        void runtime.sendYeastRuntimeAllNotesOff(512);
        const initializationB = runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });

        pendingA.resolve(nodeA);

        await expect(initializationB).resolves.toBe(nodeB);
        await expect(initializationA).resolves.toBeNull();
        expect(nodeA.allNotesOff).not.toHaveBeenCalled();
        expect(nodeB.allNotesOff).not.toHaveBeenCalled();
    });

    it('replays a panic queued during lazy initialization', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkerResult>();
        const node = makeNode(context);
        createNode.mockReturnValueOnce(pending.promise);

        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        void runtime.sendYeastRuntimeAllNotesOff(512);
        void runtime.sendYeastRuntimeAllNotesOff(1024);
        pending.resolve(node);

        await expect(initialization).resolves.toBe(node);
        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        expect(node.allNotesOff).toHaveBeenCalledTimes(1);
        expect(node.allNotesOff).toHaveBeenCalledWith(1024);
    });

    it('does not emit unscoped notes when a ready panic cannot be delivered', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const onNotesOff = vi.fn();
        const error = new Error('panic post failed');
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        node.allNotesOff.mockImplementationOnce(() => {
            throw error;
        });

        await runtime.sendYeastRuntimeAllNotesOff(512);

        expect(onNotesOff).not.toHaveBeenCalled();
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(error.message);
    });

    it('does not emit unscoped notes after an asynchronous panic rejection', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const onNotesOff = vi.fn();
        const error = new Error('panic acknowledgement rejected');
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        node.allNotesOff.mockRejectedValueOnce(error);

        await expect(runtime.sendYeastRuntimeAllNotesOff(512)).resolves.toBeUndefined();

        expect(onNotesOff).not.toHaveBeenCalled();
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(error.message);
    });

    it('does not release stale panic fallback notes into a replacement runtime', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        const pendingAck = deferred<void>();
        const onNotesOff = vi.fn();
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        nodeA.allNotesOff.mockReturnValueOnce(pendingAck.promise);
        const panic = runtime.sendYeastRuntimeAllNotesOff(512);

        const replacement = runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });
        pendingAck.resolve();

        await expect(panic).resolves.toBeUndefined();
        await expect(replacement).resolves.toBe(nodeB);
        expect(onNotesOff).not.toHaveBeenCalled();
    });

    it('does not let a stale panic fallback kill the replacement generation', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        const pendingAck = deferred<void>();
        const onNotesOff = vi.fn();
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        nodeA.allNotesOff.mockReturnValueOnce(pendingAck.promise);
        const panic = runtime.sendYeastRuntimeAllNotesOff(512);

        await expect(runtime.ensureYeastRuntime({ context: contextB, projection: projectionB })).resolves.toBe(nodeB);
        pendingAck.resolve();
        await expect(panic).resolves.toBeUndefined();

        expect(onNotesOff).not.toHaveBeenCalled();
        expect(nodeB.destroy).not.toHaveBeenCalled();
    });

    it('settles lazy initialization without replaying an uncertain queued panic', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkerResult>();
        const node = makeNode(context);
        const replacement = makeNode(context);
        const onNotesOff = vi.fn();
        const error = new Error('queued panic post failed');
        node.allNotesOff.mockImplementationOnce(() => {
            throw error;
        });
        createNode.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(replacement);

        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        void runtime.sendYeastRuntimeAllNotesOff(512);
        pending.resolve(node);

        await expect(initialization).resolves.toBeNull();
        expect(onNotesOff).not.toHaveBeenCalled();
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(error.message);

        await expect(runtime.ensureYeastRuntime({ context, projection: projectionA })).resolves.toBe(replacement);
        expect(replacement.allNotesOff).not.toHaveBeenCalled();
    });

    it('keeps panic cleanup when delivery fails without an origin', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const panicError = new Error('panic post failed');
        const onNotesOff = vi.fn();
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        node.allNotesOff.mockImplementationOnce(() => {
            throw panicError;
        });

        await expect(runtime.sendYeastRuntimeAllNotesOff(512)).resolves.toBeUndefined();
        expect(onNotesOff).not.toHaveBeenCalled();
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(panicError.message);
    });

    it('keeps each projection paired with its block when A and B overlap', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        createNode.mockResolvedValueOnce(node);
        await runtime.ensureYeastRuntime({ context, projection: projectionA });

        const calls: string[] = [];
        const blockA = deferred<MidiEvent[]>();
        node.setProjection.mockImplementation(async (projection: YeastProcessorProjection) => {
            calls.push(`projection:${projection[0]?.id ?? 'empty'}`);
        });
        node.processBlock.mockImplementation(async (events: readonly MidiEvent[]) => {
            const note = events[0]?.kind.type === 'noteOn' ? events[0].kind.note : -1;
            calls.push(`block:${note}`);
            if (note === 60) {
                return blockA.promise;
            }
            return [];
        });

        const processYeastRuntimeTransaction = (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction;
        const inputA: RuntimeBlockInput = {
            context,
            trackId: 'track-a',
            projection: projectionA,
            events: [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport: {
                bpm: 120,
                isPlaying: true,
                sampleRate: 48000,
                ppqPosition: 0,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            },
        };
        const inputB = {
            ...inputA,
            projection: projectionB,
            events: [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 61, velocity: 100 } }],
        } satisfies RuntimeBlockInput;

        const processingA = processYeastRuntimeTransaction(inputA);
        await flushRuntimeQueue();
        const processingB = processYeastRuntimeTransaction(inputB);
        await flushRuntimeQueue();

        expect(calls).toEqual(['block:60']);

        blockA.resolve([]);
        await expect(Promise.all([processingA, processingB])).resolves.toEqual([[], []]);
        expect(calls).toEqual(['block:60', 'projection:filter-1', 'block:61']);
    });

    it('reuses unchanged projection revisions and orders a changed projection before its block', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const calls: string[] = [];
        createNode.mockResolvedValueOnce(node);
        node.setProjection.mockImplementation(async (projection: YeastProcessorProjection) => {
            calls.push(`projection:${projection[0]?.id ?? 'empty'}`);
        });
        node.processBlock.mockImplementation(async () => {
            calls.push('block');
            return [];
        });

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        const processYeastRuntimeTransaction = (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction;
        const input = {
            context,
            trackId: 'track-a',
            projection: projectionA,
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport: {
                bpm: 120,
                isPlaying: true,
                sampleRate: 48000,
                ppqPosition: 0,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            },
        } satisfies RuntimeBlockInput;

        await processYeastRuntimeTransaction(input);
        await processYeastRuntimeTransaction(input);
        await processYeastRuntimeTransaction({ ...input, projection: projectionB });
        await processYeastRuntimeTransaction({ ...input, projection: projectionB });

        expect(node.setProjection).toHaveBeenCalledTimes(2);
        expect(calls).toEqual(['projection:arp-1', 'block', 'block', 'projection:filter-1', 'block', 'block']);
    });

    it('orders dynamic projection, command, and panic behind an in-flight block', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        createNode.mockResolvedValueOnce(node);
        await runtime.ensureYeastRuntime({ context, projection: projectionA });

        const calls: string[] = [];
        const block = deferred<MidiEvent[]>();
        node.setProjection.mockImplementation(async (projection: YeastProcessorProjection) => {
            calls.push(`projection:${projection[0]?.id ?? 'empty'}`);
        });
        node.processBlock.mockImplementation(async () => {
            calls.push('block');
            return block.promise;
        });
        node.sendCommand.mockImplementation(async () => {
            calls.push('command');
            return { accepted: true };
        });
        node.allNotesOff.mockImplementation(async () => {
            calls.push('panic');
        });

        const processYeastRuntimeTransaction = (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction;
        const processing = processYeastRuntimeTransaction({
            context,
            trackId: 'track-a',
            projection: projectionA,
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport: {
                bpm: 120,
                isPlaying: true,
                sampleRate: 48000,
                ppqPosition: 0,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            },
        });
        await flushRuntimeQueue();

        runtime.setYeastRuntimeProjection(projectionB);
        const command = runtime.sendYeastRuntimeCommand({ processorId: 'cm-1', type: 'chordMemory.learn' });
        const panic = runtime.sendYeastRuntimeAllNotesOff(512);
        await flushRuntimeQueue();
        expect(calls).toEqual(['block']);

        block.resolve([]);
        await expect(processing).resolves.toEqual([]);
        await expect(command).resolves.toEqual({ delivered: true });
        await expect(panic).resolves.toBeUndefined();
        await flushRuntimeQueue();
        expect(calls).toEqual(['block', 'projection:filter-1', 'command', 'panic']);
    });

    it('does not resolve initialization before a queued panic acknowledgement', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkerResult>();
        const node = makeNode(context);
        const pendingAck = deferred<void>();
        node.allNotesOff.mockReturnValueOnce(pendingAck.promise);
        createNode.mockReturnValueOnce(pending.promise);

        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        void runtime.sendYeastRuntimeAllNotesOff(512);
        pending.resolve(node);

        let settled = false;
        void initialization.then(
            () => {
                settled = true;
                return true;
            },
            () => {
                settled = true;
                return true;
            }
        );
        await Promise.resolve();
        await Promise.resolve();

        expect(node.allNotesOff).toHaveBeenCalledWith(512);
        expect(settled).toBe(false);

        pendingAck.resolve();
        await expect(initialization).resolves.toBe(node);
    });

    it('retains one same-generation panic for an initialization retry after failure', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        createNode.mockRejectedValueOnce(new Error('worker unavailable')).mockResolvedValueOnce(node);

        const failedInitialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        void runtime.sendYeastRuntimeAllNotesOff(512);

        await expect(failedInitialization).resolves.toBeNull();
        await expect(runtime.ensureYeastRuntime({ context, projection: projectionA })).resolves.toBe(node);

        expect(node.allNotesOff).toHaveBeenCalledTimes(1);
        expect(node.allNotesOff).toHaveBeenCalledWith(512);
    });

    it('returns a truthful unavailable result instead of queueing a command during initialization', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkerResult>();
        const node = makeNode(context);
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.learn' };
        createNode.mockReturnValueOnce(pending.promise);

        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });

        await expect(runtime.sendYeastRuntimeCommand(command)).resolves.toEqual({
            delivered: false,
            reason: 'runtime-unavailable',
        });
        pending.resolve(node);

        await initialization;
        expect(node.sendCommand).not.toHaveBeenCalled();
    });

    it('converts a command acknowledgement rejection to delivery-failed without an unhandled rejection', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        node.sendCommand.mockRejectedValueOnce(new Error('acknowledgement timed out'));

        const delivery = runtime.sendYeastRuntimeCommand(command);

        await expect(delivery).resolves.toEqual({
            delivered: false,
            reason: 'delivery-failed',
        });
        expect(node.destroy).toHaveBeenCalledTimes(1);
    });

    it('does not replay a delivered command on projection replay or context replacement', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        await expect(runtime.sendYeastRuntimeCommand(command)).resolves.toEqual({ delivered: true });
        runtime.setYeastRuntimeProjection(projectionB);
        await runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });

        expect(nodeA.sendCommand).toHaveBeenCalledTimes(1);
        expect(nodeA.sendCommand).toHaveBeenCalledWith(command);
        expect(nodeB.sendCommand).not.toHaveBeenCalled();
    });

    it('returns delivery-failed when the current node rejects a command acknowledgement', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.clear' };
        createNode.mockResolvedValueOnce(node);
        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        node.sendCommand.mockResolvedValueOnce({ accepted: false, error: 'not accepted' });

        await expect(runtime.sendYeastRuntimeCommand(command)).resolves.toEqual({
            delivered: false,
            reason: 'delivery-failed',
        });
    });

    it('returns delivery-failed when the runtime generation changes before acknowledgement', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        const pendingAck = deferred<{ accepted: boolean }>();
        const command: YeastProcessorCommand = { processorId: 'cm-1', type: 'chordMemory.learn' };
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        nodeA.sendCommand.mockReturnValueOnce(pendingAck.promise);
        const delivery = runtime.sendYeastRuntimeCommand(command);
        await flushRuntimeQueue();

        await runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });
        pendingAck.resolve({ accepted: true });

        await expect(delivery).resolves.toEqual({
            delivered: false,
            reason: 'delivery-failed',
        });
        expect(nodeA.sendCommand).toHaveBeenCalledTimes(1);
        expect(nodeB.sendCommand).not.toHaveBeenCalled();
    });

    it('does not return late processed events from an old generation', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        const lateResult = deferred<readonly MidiEvent[]>();
        createNode.mockResolvedValueOnce(nodeA).mockResolvedValueOnce(nodeB);

        await runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        nodeA.processBlock.mockReturnValueOnce(lateResult.promise);

        const processing = runtime.processYeastRuntimeBlock({
            context: contextA,
            trackId: 'track-a',
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport: {
                isPlaying: true,
                bpm: 120,
                timeSignature: [4, 4],
            },
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(nodeA.processBlock).toHaveBeenCalledTimes(1);

        await expect(runtime.ensureYeastRuntime({ context: contextB, projection: projectionB })).resolves.toBe(nodeB);
        lateResult.resolve([]);

        await expect(processing).rejects.toThrow(/runtime changed/);
        expect(nodeB.processBlock).not.toHaveBeenCalled();
    });

    it('does not initialize a stale queued transaction after context replacement', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const nodeB = makeNode(contextB);
        createNode.mockResolvedValueOnce(nodeB);

        const processYeastRuntimeTransaction = (runtime as RuntimeWithTransaction).processYeastRuntimeTransaction;
        const staleProcessing = processYeastRuntimeTransaction({
            context: contextA,
            trackId: 'track-a',
            projection: projectionA,
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport: {
                bpm: 120,
                isPlaying: true,
                sampleRate: 48000,
                ppqPosition: 0,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            },
        });

        const replacement = runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });

        await expect(replacement).resolves.toBe(nodeB);
        await expect(staleProcessing).resolves.toBeNull();
        expect(nodeB.processBlock).not.toHaveBeenCalled();
    });
});
