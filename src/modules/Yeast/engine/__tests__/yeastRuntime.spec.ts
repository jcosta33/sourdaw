import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';
import type { YeastProcessorCommand } from '../../models/YeastProcessorCommand';
import type { YeastProcessorProjection } from '../../models/YeastProcessorProjection';
import type { YeastWorkletNodeResult } from '../YeastWorkletNode';

const createNode = vi.hoisted(() => vi.fn());

vi.mock('../YeastWorkletNode', () => ({
    createYeastWorkletNode: createNode,
}));

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

function makeNode(context: BaseAudioContext) {
    return {
        context,
        processBlock: (
            _events: readonly MidiEvent[],
            _blockStart: number,
            _blockEnd: number,
            _transport: TransportInfo
        ) => Promise.resolve([]),
        setProjection: vi.fn(),
        sendCommand: vi.fn(() => Promise.resolve({ accepted: true })),
        allNotesOff: vi.fn(),
        onNotesOff: vi.fn(() => () => {}),
        destroy: vi.fn(),
    };
}

const projectionA: YeastProcessorProjection = [
    { id: 'arp-1', type: 'arpeggiator', bypassed: false, params: { rate_denom: 8 } },
];
const projectionB: YeastProcessorProjection = [
    { id: 'filter-1', type: 'filter', bypassed: true, params: { min_note: 48 } },
];

async function loadRuntime(): Promise<typeof import('../yeastRuntime')> {
    vi.resetModules();
    return import('../yeastRuntime');
}

describe('yeastRuntime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('replays the latest projection when lazy worklet initialization resolves', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkletNodeResult>();
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

    it('discards an old context runtime and replays the current projection to the replacement', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const pendingA = deferred<YeastWorkletNodeResult>();
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

    it('discards a panic queued for context A when context B replaces its generation', async () => {
        const runtime = await loadRuntime();
        const contextA = {} as BaseAudioContext;
        const contextB = {} as BaseAudioContext;
        const pendingA = deferred<YeastWorkletNodeResult>();
        const nodeA = makeNode(contextA);
        const nodeB = makeNode(contextB);
        createNode.mockReturnValueOnce(pendingA.promise).mockResolvedValueOnce(nodeB);

        const initializationA = runtime.ensureYeastRuntime({ context: contextA, projection: projectionA });
        runtime.sendYeastRuntimeAllNotesOff(512);
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
        const pending = deferred<YeastWorkletNodeResult>();
        const node = makeNode(context);
        createNode.mockReturnValueOnce(pending.promise);

        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.sendYeastRuntimeAllNotesOff(512);
        runtime.sendYeastRuntimeAllNotesOff(1024);
        pending.resolve(node);

        await expect(initialization).resolves.toBe(node);
        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        expect(node.allNotesOff).toHaveBeenCalledTimes(1);
        expect(node.allNotesOff).toHaveBeenCalledWith(1024);
    });

    it('falls back to valid MIDI panic notes when a ready panic cannot be delivered', async () => {
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

        runtime.sendYeastRuntimeAllNotesOff(512);

        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith(Array.from({ length: 128 }, (_, note) => note));
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(error.message);
    });

    it('settles lazy initialization as unavailable and does not replay an uncertain queued panic', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkletNodeResult>();
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
        runtime.sendYeastRuntimeAllNotesOff(512);
        pending.resolve(node);

        await expect(initialization).resolves.toBeNull();
        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(onNotesOff).toHaveBeenCalledWith(Array.from({ length: 128 }, (_, note) => note));
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(error.message);

        await expect(runtime.ensureYeastRuntime({ context, projection: projectionA })).resolves.toBe(replacement);
        expect(replacement.allNotesOff).not.toHaveBeenCalled();
    });

    it('keeps panic cleanup when the owner fallback handler throws', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        const panicError = new Error('panic post failed');
        const fallbackError = new Error('fallback failed');
        const onNotesOff = vi.fn(() => {
            throw fallbackError;
        });
        createNode.mockResolvedValueOnce(node);

        await runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.setYeastRuntimeNotesOffHandler(onNotesOff);
        node.allNotesOff.mockImplementationOnce(() => {
            throw panicError;
        });

        expect(() => runtime.sendYeastRuntimeAllNotesOff(512)).not.toThrow();
        expect(onNotesOff).toHaveBeenCalledTimes(1);
        expect(node.destroy).toHaveBeenCalledTimes(1);
        expect(runtime.getYeastRuntimeStatus()).toBe('unavailable');
        expect(runtime.getYeastRuntimeError()).toBe(panicError.message);
    });

    it('retains one same-generation panic for an initialization retry after failure', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const node = makeNode(context);
        createNode.mockRejectedValueOnce(new Error('worklet unavailable')).mockResolvedValueOnce(node);

        const failedInitialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.sendYeastRuntimeAllNotesOff(512);

        await expect(failedInitialization).resolves.toBeNull();
        await expect(runtime.ensureYeastRuntime({ context, projection: projectionA })).resolves.toBe(node);

        expect(node.allNotesOff).toHaveBeenCalledTimes(1);
        expect(node.allNotesOff).toHaveBeenCalledWith(512);
    });

    it('returns a truthful unavailable result instead of queueing a command during initialization', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkletNodeResult>();
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

        await runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });
        pendingAck.resolve({ accepted: true });

        await expect(delivery).resolves.toEqual({
            delivered: false,
            reason: 'delivery-failed',
        });
        expect(nodeA.sendCommand).toHaveBeenCalledTimes(1);
        expect(nodeB.sendCommand).not.toHaveBeenCalled();
    });
});
