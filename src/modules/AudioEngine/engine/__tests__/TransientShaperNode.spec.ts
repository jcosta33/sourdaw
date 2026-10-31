import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

import { createTransientShaperNode } from '../TransientShaperNode';

const lease = vi.hoisted(() => ({
    module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    commit: vi.fn(),
    release: vi.fn(),
}));
vi.mock('#/infra/audioWorklet/workletInitShared', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/audioWorklet/workletInitShared')>()),
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue(lease),
}));
vi.mock('../../services/transientShaperProcessor.ts?worker&url', () => ({ default: 'processor-url' }));
class Param {
    constructor(private currentValue = 1) {}
    valueWrites = vi.fn();
    get value() {
        return this.currentValue;
    }
    set value(value: number) {
        this.currentValue = value;
        this.valueWrites(value);
    }
    cancelScheduledValues = vi.fn();
    setValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
}
let instances: FakeNode[] = [];
let initialEpoch = 0;
let constructionFails = false;
class FakeNode {
    parameters = new Map([
        ['attackGain', new Param()],
        ['sustainGain', new Param()],
        ['_resetEpoch', new Param(initialEpoch)],
    ]);
    port = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn(), close: vi.fn() };
    disconnect = vi.fn();
    onprocessorerror: (() => void) | null = null;
    constructor() {
        if (constructionFails) {
            throw new Error('construction failed');
        }
        instances.push(this);
    }
    message(data: unknown) {
        this.port.onmessage?.(new MessageEvent('message', { data }));
    }
}
const context = { currentTime: 0.25, sampleRate: 48000 } as BaseAudioContext;
beforeEach(() => {
    instances = [];
    initialEpoch = 0;
    constructionFails = false;
    vi.stubGlobal('AudioWorkletNode', FakeNode);
    vi.clearAllMocks();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
async function create(signal?: AbortSignal, onFailure?: (message: string) => void) {
    const node = await createTransientShaperNode(context, signal, onFailure);
    void node.ready.catch(() => undefined);
    const fake = instances[0];
    if (!fake) {
        throw new Error('node not constructed');
    }
    return { node, fake };
}
function dispose(node: Awaited<ReturnType<typeof createTransientShaperNode>>, fake: FakeNode) {
    node.destroy();
    fake.message({ type: 'disposed' });
}

describe('Transient Shaper host lifecycle and scheduling', () => {
    it('promotes only on real ready/error handshake messages and commits the module lease', async () => {
        const { node, fake } = await create();
        let settled = false;
        void node.ready.then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        fake.message({ type: 'ready', latency: 0 });
        await expect(node.ready).resolves.toMatchObject({ latency: 0 });
        expect(lease.commit).toHaveBeenCalledOnce();
        expect(fetchWasmModule).toHaveBeenCalledWith(expect.objectContaining({ ctx: context, bundleId: 'daw-dsp' }));
        dispose(node, fake);
    });
    it('schedules finite clamped public gains at their actual frame times and refuses the epoch as a public control', async () => {
        const { node, fake } = await create();
        node.setParam('attackGain', 20, 24000);
        node.setParam('sustainGain', -20);
        node.setParam('attackGain', Number.NaN);
        node.setParam('_resetEpoch', 4);
        node.setParam('attackGain', 1, -1);
        expect(fake.parameters.get('attackGain')?.setValueAtTime).toHaveBeenCalledExactlyOnceWith(2, 0.5);
        expect(fake.parameters.get('sustainGain')?.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0, 0.25);
        expect(fake.parameters.get('_resetEpoch')?.setValueAtTime).not.toHaveBeenCalled();
        expect(node.acceptsScheduledParam('_resetEpoch')).toBe(false);
        node.scheduleParam('sustainGain', [
            { startFrame: 24000, endFrame: 48000, startValue: 0.5, endValue: 1.5 },
            { startFrame: 48000, endFrame: 48000, startValue: 1, endValue: 1 },
        ]);
        expect(fake.parameters.get('sustainGain')?.linearRampToValueAtTime).toHaveBeenCalledWith(1.5, 1);
        expect(fake.parameters.get('sustainGain')?.setValueAtTime).toHaveBeenLastCalledWith(1, 1);
        dispose(node, fake);
    });
    it('encodes integer gain/ramp/reset frames without a one-sample floating-point overshoot', async () => {
        const exactContext = { currentTime: 896 / 48000, sampleRate: 48000 } as BaseAudioContext;
        const node = await createTransientShaperNode(exactContext);
        void node.ready.catch(() => undefined);
        const fake = instances[0];
        if (!fake) {
            throw new Error('No worklet');
        }
        node.setParam('attackGain', 1.5, 1665);
        node.scheduleParam('sustainGain', [{ startFrame: 1665, endFrame: 3329, startValue: 0.5, endValue: 1 }]);
        node.setBypass(true);
        node.setBypass(false);
        const gainTime = fake.parameters.get('attackGain')?.setValueAtTime.mock.calls[0]?.[1];
        const rampTime = fake.parameters.get('sustainGain')?.linearRampToValueAtTime.mock.calls[0]?.[1];
        const reset = fake.parameters.get('_resetEpoch');
        if (gainTime === undefined || rampTime === undefined || !reset) {
            throw new Error('No scheduled event');
        }
        expect(Math.ceil(gainTime * 48000)).toBe(1665);
        expect(Math.ceil(rampTime * 48000)).toBe(3329);
        expect(reset.valueWrites.mock.calls).toEqual([[1], [2]]);
        expect(reset.cancelScheduledValues.mock.calls).toEqual([[0], [0]]);
        // 896 / 48000 sits above frame 896, so the raw time would land on frame 897.
        node.setParam('sustainGain', 1);
        node.setParam('attackGain', 2, 0);
        const immediateTime = fake.parameters.get('sustainGain')?.setValueAtTime.mock.lastCall?.[1];
        const reachedTime = fake.parameters.get('attackGain')?.setValueAtTime.mock.lastCall?.[1];
        expect(immediateTime === undefined ? undefined : Math.ceil(immediateTime * 48000)).toBe(896);
        expect(reachedTime === undefined ? undefined : Math.ceil(reachedTime * 48000)).toBe(896);
        dispose(node, fake);
    });
    it('queues exact reset epochs synchronously for actual bypass transitions, including coalesced transitions', async () => {
        const { node, fake } = await create();
        node.setBypass(true);
        node.setBypass(true);
        node.setBypass(false);
        node.setBypass(true);
        expect(fake.parameters.get('_resetEpoch')?.valueWrites.mock.calls).toEqual([[1], [2], [3]]);
        expect(fake.parameters.get('_resetEpoch')?.cancelScheduledValues.mock.calls).toEqual([[0], [0], [0]]);
        expect(fake.port.postMessage.mock.calls).toEqual([
            [{ type: 'init' }],
            [{ type: 'reset', epoch: 1 }],
            [{ type: 'reset', epoch: 2 }],
            [{ type: 'reset', epoch: 3 }],
        ]);
        dispose(node, fake);
    });
    it('posts immediate and already reached gains for the resume frame Chromium cannot reach through the AudioParam', async () => {
        // 193024 / 48000 * 48000 sits above 193024, so Chromium lands an event
        // at this currentTime on frame 193025 whatever time the write names.
        const pausedContext = { currentTime: 193024 / 48000, sampleRate: 48000 } as BaseAudioContext;
        const node = await createTransientShaperNode(pausedContext);
        void node.ready.catch(() => undefined);
        const fake = instances[0];
        if (!fake) {
            throw new Error('No worklet');
        }
        node.setParam('attackGain', 2);
        node.setParam('sustainGain', 0.25, 0);
        node.setParam('attackGain', 9, 193024);
        node.setParam('sustainGain', 0.5, 193025);
        node.setParam('attackGain', Number.NaN);
        node.setParam('_resetEpoch', 4);
        node.setBypass(true);
        expect(fake.port.postMessage.mock.calls.slice(1)).toEqual([
            [{ type: 'gain', name: 'attackGain', value: 2, frame: 193024 }],
            [{ type: 'gain', name: 'sustainGain', value: 0.25, frame: 193024 }],
            [{ type: 'gain', name: 'attackGain', value: 2, frame: 193024 }],
            [{ type: 'reset', epoch: 1 }],
        ]);
        expect(fake.parameters.get('sustainGain')?.setValueAtTime).toHaveBeenLastCalledWith(0.5, 193025 / 48000);
        dispose(node, fake);
        node.setParam('attackGain', 1);
        expect(fake.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gain', value: 1 }));
    });
    it('uses the final exact Float32 value as terminal failure and never wraps', async () => {
        initialEpoch = 16777214;
        const failure = vi.fn();
        const { node, fake } = await create(undefined, failure);
        node.setBypass(true);
        node.setBypass(false);
        expect(fake.parameters.get('_resetEpoch')?.valueWrites).toHaveBeenCalledExactlyOnceWith(16777215);
        expect(failure).toHaveBeenCalledExactlyOnceWith('Transient Shaper reset epoch exhausted');
        await expect(node.ready).rejects.toThrow('epoch exhausted');
        dispose(node, fake);
    });
    it('routes post-ready processor faults once, and abort/destroy stop every later control and close on acknowledgement', async () => {
        const abort = new AbortController();
        const failure = vi.fn();
        const { node, fake } = await create(abort.signal, failure);
        fake.message({ type: 'ready' });
        await node.ready;
        fake.onprocessorerror?.();
        fake.onprocessorerror?.();
        expect(failure).toHaveBeenCalledTimes(1);
        abort.abort();
        node.destroy();
        const calls = fake.port.postMessage.mock.calls.length;
        node.setParam('attackGain', 2);
        node.setBypass(true);
        expect(fake.port.postMessage).toHaveBeenCalledTimes(calls);
        expect(fake.parameters.get('attackGain')?.setValueAtTime).not.toHaveBeenCalled();
        fake.message({ type: 'disposed' });
        expect(fake.port.close).toHaveBeenCalledOnce();
        expect(fake.disconnect).toHaveBeenCalledOnce();
    });
    it('releases an uncommitted lease on construction failure', async () => {
        constructionFails = true;
        await expect(createTransientShaperNode(context)).rejects.toThrow('construction failed');
        expect(lease.release).toHaveBeenCalledOnce();
        expect(lease.commit).not.toHaveBeenCalled();
    });
    it('bounds disposal ownership when the worklet cannot acknowledge', async () => {
        vi.useFakeTimers();
        const { node, fake } = await create();
        node.destroy();
        expect(fake.port.close).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(fake.port.close).toHaveBeenCalledOnce();
    });
});

describe('Transient Shaper registry promotion lifecycle', () => {
    async function registry() {
        const { findWasmDescriptor } = await import('../wasmDeviceRegistry');
        const { setAudioDeviceRuntimeSink } = await import('../audioDeviceRuntimeSink');
        const loaded = vi.fn();
        setAudioDeviceRuntimeSink({ emitDeviceLoaded: loaded });
        const descriptor = findWasmDescriptor('transient-shaper');
        if (!descriptor) {
            throw new Error('No real registry descriptor');
        }
        const registryContext = { ...context, createGain: () => ({ disconnect: vi.fn() }) } as unknown as AudioContext;
        return { descriptor, registryContext, loaded };
    }
    afterEach(async () => {
        const { setAudioDeviceRuntimeSink } = await import('../audioDeviceRuntimeSink');
        setAudioDeviceRuntimeSink({});
    });
    it.each(['stale', 'rejected', 'aborted'] as const)('never emits loaded after %s promotion', async (state) => {
        const { descriptor, registryContext, loaded } = await registry();
        const abort = new AbortController();
        const onLoaded = vi.fn(() => state !== 'rejected');
        const load = descriptor.create({
            context: registryContext,
            deviceId: 'shaper',
            deviceType: 'transient-shaper',
            signal: abort.signal,
            isCurrent: () => state !== 'stale',
            onLoaded,
        });
        await vi.waitFor(() => expect(instances).toHaveLength(1));
        const fake = instances[0];
        if (!fake) {
            throw new Error('No constructed worklet');
        }
        if (state === 'aborted') {
            abort.abort();
        }
        fake.message({ type: 'ready' });
        await load.loadPromise;
        expect(loaded).not.toHaveBeenCalled();
        expect(fake.disconnect).toHaveBeenCalledOnce();
        if (state !== 'rejected') {
            expect(onLoaded).not.toHaveBeenCalled();
        }
        fake.message({ type: 'disposed' });
    });
    it('retires post-ready faults and requests recovery only after the owning graph accepted replacement', async () => {
        const { descriptor, registryContext, loaded } = await registry();
        const replace = vi.fn(() => true),
            recover = vi.fn();
        const onLoaded = vi.fn((candidate: unknown) => candidate !== undefined);
        const load = descriptor.create({
            context: registryContext,
            deviceId: 'shaper',
            deviceType: 'transient-shaper',
            onLoaded,
            onRuntimeFailure: replace,
            onRuntimeRecovery: recover,
        });
        await vi.waitFor(() => expect(instances).toHaveLength(1));
        const fake = instances[0];
        if (!fake) {
            throw new Error('No constructed worklet');
        }
        fake.message({ type: 'ready' });
        await load.loadPromise;
        expect(loaded).toHaveBeenCalledOnce();
        fake.onprocessorerror?.();
        fake.onprocessorerror?.();
        expect(replace).toHaveBeenCalledOnce();
        expect(recover).toHaveBeenCalledExactlyOnceWith(load.placeholder);
        expect(onLoaded.mock.calls[0]?.[0]).toMatchObject({ controller: { ready: false } });
        fake.message({ type: 'disposed' });
    });
    it('does not emit loaded when promotion synchronously exposes a terminal runtime fault', async () => {
        const { descriptor, registryContext, loaded } = await registry();
        const replace = vi.fn(() => true);
        const load = descriptor.create({
            context: registryContext,
            deviceId: 'shaper',
            deviceType: 'transient-shaper',
            onLoaded: () => {
                instances[0]?.onprocessorerror?.();
                return true;
            },
            onRuntimeFailure: replace,
        });
        await vi.waitFor(() => expect(instances).toHaveLength(1));
        const fake = instances[0];
        if (!fake) {
            throw new Error('No constructed worklet');
        }
        fake.message({ type: 'ready' });
        await load.loadPromise;
        expect(loaded).not.toHaveBeenCalled();
        expect(replace).toHaveBeenCalledOnce();
        fake.message({ type: 'disposed' });
    });
});
