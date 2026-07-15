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

function makeNode(context: BaseAudioContext): YeastWorkletNodeResult {
    return {
        context,
        processBlock: async (
            _events: readonly MidiEvent[],
            _blockStart: number,
            _blockEnd: number,
            _transport: TransportInfo
        ) => [],
        setProjection: vi.fn(),
        sendCommand: vi.fn(),
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

    it('replays a panic queued during lazy initialization', async () => {
        const runtime = await loadRuntime();
        const context = {} as BaseAudioContext;
        const pending = deferred<YeastWorkletNodeResult>();
        const node = makeNode(context);
        createNode.mockReturnValueOnce(pending.promise);

        const initialization = runtime.ensureYeastRuntime({ context, projection: projectionA });
        runtime.sendYeastRuntimeAllNotesOff(512);
        pending.resolve(node);

        await expect(initialization).resolves.toBe(node);
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

        expect(runtime.sendYeastRuntimeCommand(command)).toEqual({
            delivered: false,
            reason: 'runtime-unavailable',
        });
        pending.resolve(node);

        await initialization;
        expect(node.sendCommand).not.toHaveBeenCalled();
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
        expect(runtime.sendYeastRuntimeCommand(command)).toEqual({ delivered: true });
        runtime.setYeastRuntimeProjection(projectionB);
        await runtime.ensureYeastRuntime({ context: contextB, projection: projectionB });

        expect(nodeA.sendCommand).toHaveBeenCalledTimes(1);
        expect(nodeA.sendCommand).toHaveBeenCalledWith(command);
        expect(nodeB.sendCommand).not.toHaveBeenCalled();
    });
});
