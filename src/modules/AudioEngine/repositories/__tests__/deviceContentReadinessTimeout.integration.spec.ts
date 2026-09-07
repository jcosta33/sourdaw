import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '#/helpers/__tests__/audioContext.mock';

import { setAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';

import {
    createAudioEngineTopologyTestHarness as createAudioEngine,
    type AudioEngineTopologyTestHarness,
} from './createAudioEngineTopologyTestHarness';

import type { CrumbsNodeResult } from '../../engine/CrumbsNode';
import type { DeviceContentLoadOutcome } from '../../engine/deviceReadinessDiagnostics';

const crumbsFactory = vi.hoisted(() => ({ createCrumbsNode: vi.fn() }));

vi.mock('../../engine/CrumbsNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/CrumbsNode')>()),
    createCrumbsNode: crumbsFactory.createCrumbsNode,
}));

class FakeWorkletNode {
    readonly port = { postMessage: vi.fn(), close: vi.fn() };
    readonly connect = vi.fn();
    readonly disconnect = vi.fn();
}

type CrumbsGeneration = {
    readonly destroy: ReturnType<typeof vi.fn>;
    readonly result: CrumbsNodeResult;
    readonly signal: Promise<AbortSignal>;
};

type ContentLoad = {
    readonly signal: AbortSignal;
    readonly settle: (outcome: DeviceContentLoadOutcome) => void;
};

type ContentLoadObserver = {
    readonly promise: Promise<ContentLoad>;
    readonly resolve: (load: ContentLoad) => void;
};

function asAudioContext(context: MockAudioContext): AudioContext {
    return context as unknown as AudioContext;
}

function asWorkletNode(node: FakeWorkletNode): AudioWorkletNode {
    return node as unknown as AudioWorkletNode;
}

function createCrumbsGeneration(): CrumbsGeneration {
    const workletNode = new FakeWorkletNode();
    const destroy = vi.fn();
    const result: CrumbsNodeResult = {
        workletNode: asWorkletNode(workletNode),
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        allNotesOff: vi.fn(),
        allSoundOff: vi.fn(),
        setParam: vi.fn(),
        setMode: vi.fn(),
        setBypass: vi.fn(),
        connect: workletNode.connect,
        disconnect: workletNode.disconnect,
        destroy,
        ready: Promise.resolve({}),
    };
    const signal = Promise.withResolvers<AbortSignal>();
    crumbsFactory.createCrumbsNode.mockImplementationOnce(
        (
            _context: BaseAudioContext,
            _wasmUrl?: string,
            _onFault?: (message: string) => void,
            ownerSignal?: AbortSignal
        ) => {
            if (!ownerSignal) {
                throw new Error('Expected TrackNode to pass its device-load signal to Crumbs');
            }
            signal.resolve(ownerSignal);
            return Promise.resolve(result);
        }
    );
    return { destroy, result, signal: signal.promise };
}

function observeContentLoad(
    loads: ContentLoad[],
    observers: ContentLoadObserver[],
    index: number
): Promise<ContentLoad> {
    const load = loads[index];
    return load ? Promise.resolve(load) : observers[index]!.promise;
}

function readinessFor(engine: AudioEngineTopologyTestHarness, deviceId: string) {
    return engine.getDeviceReadinessDiagnostics().devices.find((device) => device.deviceId === deviceId);
}

function liveDevice(engine: AudioEngineTopologyTestHarness, deviceId: string) {
    return engine.getTrackStrip('track-1')?.deviceNodes.find((device) => device.deviceId === deviceId);
}

describe('createWebAudioEngine content-readiness timeout cohort', () => {
    let engine: AudioEngineTopologyTestHarness;
    let loads: ContentLoad[];
    let loadObservers: ContentLoadObserver[];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        vi.clearAllMocks();
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        loads = [];
        loadObservers = [Promise.withResolvers<ContentLoad>(), Promise.withResolvers<ContentLoad>()];
        setAudioDeviceRuntimeSink({
            prepareCrumbsDevice: ({ signal }) => {
                if (!signal) {
                    throw new Error('Expected TrackNode to own the Crumbs content signal');
                }
                const settlement = Promise.withResolvers<DeviceContentLoadOutcome>();
                const onAbort = (): void => settlement.resolve('cancelled');
                signal.addEventListener('abort', onAbort, { once: true });
                void settlement.promise.finally(() => signal.removeEventListener('abort', onAbort));
                const load = { signal, settle: settlement.resolve };
                const loadIndex = loads.push(load) - 1;
                loadObservers[loadIndex]?.resolve(load);
                return settlement.promise;
            },
        });
        engine = createAudioEngine(asAudioContext(createMockAudioContext()));
    });

    afterEach(async () => {
        setAudioDeviceRuntimeSink({});
        await engine.dispose();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('does not let a reset generation timeout abort its replacement', async () => {
        const generationA = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
        const loadA = await observeContentLoad(loads, loadObservers, 0);

        let waitSettled = false;
        const waitingForA = engine.waitForDevices().then(() => {
            waitSettled = true;
        });
        engine.resetGraph();
        expect(loadA.signal.aborted).toBe(true);
        expect(generationA.destroy).toHaveBeenCalledOnce();

        const generationB = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
        const loadB = await observeContentLoad(loads, loadObservers, 1);
        await vi.advanceTimersByTimeAsync(0);
        expect(waitSettled).toBe(true);
        expect(readinessFor(engine, 'crumbs-1')).toMatchObject({ status: 'content-pending' });

        await vi.advanceTimersByTimeAsync(10000);
        await waitingForA;
        expect(loadB.signal.aborted).toBe(false);
        expect(generationB.destroy).not.toHaveBeenCalled();
        expect(readinessFor(engine, 'crumbs-1')).toMatchObject({ status: 'content-pending' });

        loadB.settle('ready');
        await vi.advanceTimersByTimeAsync(0);
        expect(readinessFor(engine, 'crumbs-1')).toMatchObject({ status: 'ready' });
        expect(liveDevice(engine, 'crumbs-1')?.inputNode).toBe(generationB.result.workletNode);
    });

    it('does not let a removed same-id generation timeout abort its same-graph replacement', async () => {
        const generationA = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
        const loadA = await observeContentLoad(loads, loadObservers, 0);

        let waitSettled = false;
        const waitingForA = engine.waitForDevices().then(() => {
            waitSettled = true;
        });
        engine.removeDeviceFromStrip('track-1', 'crumbs-1');
        expect(loadA.signal.aborted).toBe(true);
        expect(generationA.destroy).toHaveBeenCalledOnce();

        const generationB = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
        const loadB = await observeContentLoad(loads, loadObservers, 1);
        await vi.advanceTimersByTimeAsync(0);
        expect(waitSettled).toBe(true);

        await vi.advanceTimersByTimeAsync(10000);
        await waitingForA;
        expect(loadB.signal.aborted).toBe(false);
        expect(generationB.destroy).not.toHaveBeenCalled();

        loadB.settle('ready');
        await vi.advanceTimersByTimeAsync(0);
        expect(readinessFor(engine, 'crumbs-1')).toMatchObject({ status: 'ready' });
        expect(liveDevice(engine, 'crumbs-1')?.inputNode).toBe(generationB.result.workletNode);
    });

    it('does not consume a synchronous same-id replacement installed by the captured abort callback', async () => {
        createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
        const loadA = await observeContentLoad(loads, loadObservers, 0);
        let generationB: CrumbsGeneration | undefined;
        loadA.signal.addEventListener(
            'abort',
            () => {
                engine.removeDeviceFromStrip('track-1', 'crumbs-1');
                generationB = createCrumbsGeneration();
                engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
            },
            { once: true }
        );

        const waitingForA = engine.waitForDevices();
        await vi.advanceTimersByTimeAsync(10000);
        await waitingForA;
        await vi.advanceTimersByTimeAsync(0);

        if (!generationB) {
            throw new Error('Expected generation A abort to install generation B');
        }
        const loadBSignal = await generationB.signal;
        expect({
            signalAborted: loadBSignal.aborted,
            admittedContentLoads: loads.length,
            destroyCalls: generationB.destroy.mock.calls.length,
            readiness: readinessFor(engine, 'crumbs-1'),
            retainedRealNode: liveDevice(engine, 'crumbs-1')?.inputNode === generationB.result.workletNode,
        }).toEqual({
            signalAborted: false,
            admittedContentLoads: 2,
            destroyCalls: 0,
            readiness: expect.objectContaining({ status: 'content-pending', failureStage: null }),
            retainedRealNode: true,
        });

        const loadB = await observeContentLoad(loads, loadObservers, 1);
        loadB.settle('ready');
        await vi.advanceTimersByTimeAsync(0);
        expect(loadB.signal.aborted).toBe(false);
        expect(readinessFor(engine, 'crumbs-1')).toMatchObject({ status: 'ready', failureStage: null });
        expect(liveDevice(engine, 'crumbs-1')?.inputNode).toBe(generationB.result.workletNode);
    });

    it('times out only the captured stalled load when a new load starts in the same graph', async () => {
        const originalGeneration = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'original', 'builtin-crumbs');
        const originalLoad = await observeContentLoad(loads, loadObservers, 0);
        const waitingForOriginal = engine.waitForDevices();

        const newGeneration = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'new', 'builtin-crumbs');
        const newLoad = await observeContentLoad(loads, loadObservers, 1);

        await vi.advanceTimersByTimeAsync(10000);
        await waitingForOriginal;

        expect(originalLoad.signal.aborted).toBe(true);
        expect(originalGeneration.destroy).toHaveBeenCalledOnce();
        expect(readinessFor(engine, 'original')).toMatchObject({ status: 'failed', failureStage: 'content' });
        expect(newLoad.signal.aborted).toBe(false);
        expect(newGeneration.destroy).not.toHaveBeenCalled();
        expect(readinessFor(engine, 'new')).toMatchObject({ status: 'content-pending' });

        newLoad.settle('ready');
        await vi.advanceTimersByTimeAsync(0);
        expect(readinessFor(engine, 'new')).toMatchObject({ status: 'ready' });
        expect(liveDevice(engine, 'new')?.inputNode).toBe(newGeneration.result.workletNode);
    });

    it('resolves after every captured content load becomes ready', async () => {
        const generation = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
        const load = await observeContentLoad(loads, loadObservers, 0);
        const waiting = engine.waitForDevices();

        load.settle('ready');

        await expect(waiting).resolves.toBeUndefined();
        expect(load.signal.aborted).toBe(false);
        expect(generation.destroy).not.toHaveBeenCalled();
        expect(readinessFor(engine, 'crumbs-1')).toMatchObject({ status: 'ready', failureStage: null });
        expect(liveDevice(engine, 'crumbs-1')?.inputNode).toBe(generation.result.workletNode);
    });

    it('resolves after rolling back an actually captured content stall', async () => {
        const generation = createCrumbsGeneration();
        engine.addDeviceToStrip('track-1', 'crumbs-1', 'builtin-crumbs');
        const load = await observeContentLoad(loads, loadObservers, 0);
        const waiting = engine.waitForDevices();

        await vi.advanceTimersByTimeAsync(10000);

        await expect(waiting).resolves.toBeUndefined();
        expect(load.signal.aborted).toBe(true);
        expect(generation.destroy).toHaveBeenCalledOnce();
        expect(readinessFor(engine, 'crumbs-1')).toMatchObject({
            status: 'failed',
            failureStage: 'content',
        });
    });
});
