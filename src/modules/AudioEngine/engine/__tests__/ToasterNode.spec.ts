import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { telemetryAllocator, TELEMETRY_SEQ_IDX, TOASTER_IDX } from '../telemetryAllocator';
import { createToasterNode, isToasterDevice } from '../ToasterNode';

// Mock the worklet-init helpers so createToasterNode resolves without a real
// AudioContext / worklet module / WASM fetch. The ready handshake resolves
// immediately so the factory's `await` chain completes.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'late' as const,
        reject: () => 'late' as const,
        isSettled: () => true,
    })),
}));

vi.mock('../../services/toasterProcessor.ts?worker&url', () => ({ default: 'toaster-processor-url' }));

describe('isToasterDevice', () => {
    it('should return true only for the toaster device type string', () => {
        expect(isToasterDevice('toaster')).toBe(true);
        expect(isToasterDevice('fermenter')).toBe(false);
    });
});

describe('createToasterNode', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let disconnect: ReturnType<typeof vi.fn>;
    let connect: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let resume: ReturnType<typeof vi.fn>;
    let padGainNodes: Array<ReturnType<typeof createMockAudioNode<'gain'>>>;
    let workletOptions: AudioWorkletNodeOptions | undefined;
    let onmessage: ((event: MessageEvent<unknown>) => void) | null;
    let stateChangeListener: EventListener | null;
    let contextState: AudioContextState;

    beforeEach(() => {
        postMessage = vi.fn();
        disconnect = vi.fn();
        connect = vi.fn();
        close = vi.fn();
        resume = vi.fn().mockResolvedValue(undefined);
        padGainNodes = [];
        workletOptions = undefined;
        onmessage = null;
        stateChangeListener = null;
        contextState = 'running';

        class FakeWorkletNode {
            constructor(_context: BaseAudioContext, _name: string, options?: AudioWorkletNodeOptions) {
                workletOptions = options;
            }
            port = {
                postMessage,
                close,
                get onmessage() {
                    return onmessage;
                },
                set onmessage(handler: ((event: MessageEvent<unknown>) => void) | null) {
                    onmessage = handler;
                },
            };
            onprocessorerror: ((event: Event) => unknown) | null = null;
            connect = connect;
            disconnect = disconnect;
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    function makeCtx(state: 'running' | 'suspended' = 'running') {
        contextState = state;
        class FakeAudioContext {
            get state() {
                return contextState;
            }
            sampleRate = 48_000;
            resume = resume;
            addEventListener(type: string, listener: EventListener) {
                if (type === 'statechange') {
                    stateChangeListener = listener;
                }
            }
            removeEventListener(type: string, listener: EventListener) {
                if (type === 'statechange' && stateChangeListener === listener) {
                    stateChangeListener = null;
                }
            }
            createGain() {
                const gainNode = createMockAudioNode('gain');
                padGainNodes.push(gainNode);
                return gainNode;
            }
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        return new FakeAudioContext() as unknown as BaseAudioContext;
    }

    it('should resume the context only when it starts out suspended', async () => {
        await createToasterNode(makeCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createToasterNode(makeCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should post noteOn with a default midiNote and a velocity clamped to the MIDI range', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.noteOn(2, 90, undefined, 128);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOn', pad: 2, velocity: 90, note: 60, sampleFrame: 128 });

        node.noteOn(3, 200);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'noteOn',
            pad: 3,
            velocity: 127,
            note: 60,
            sampleFrame: undefined,
        });

        node.noteOn(4, -10);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'noteOn',
            pad: 4,
            velocity: 0,
            note: 60,
            sampleFrame: undefined,
        });
    });

    it('should post noteOff with the given pad and sample frame', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.noteOff(2, 256);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOff', pad: 2, sampleFrame: 256 });
    });

    it('should post a scheduledHit with the full payload, defaulting midiNote to 60', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.scheduleHit({
            pad: 1,
            velocity: 300,
            sampleFrame: 64,
            padParams: [{ name: 'tune', value: 0.5 }],
            restoreEngineType: 2,
            fillCondition: 'fill',
        });

        expect(postMessage).toHaveBeenCalledWith({
            type: 'scheduledHit',
            pad: 1,
            velocity: 127,
            note: 60,
            sampleFrame: 64,
            padParams: [{ name: 'tune', value: 0.5 }],
            restoreEngineType: 2,
            fillCondition: 'fill',
        });
    });

    it('should post cancelScheduled, allNotesOff and fillState messages', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.cancelScheduled();
        expect(postMessage).toHaveBeenCalledWith({ type: 'cancelScheduled' });

        node.allNotesOff();
        expect(postMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });

        node.setFillActive(true);
        expect(postMessage).toHaveBeenCalledWith({ type: 'fillState', active: true });
    });

    it('should forward a finite setParam value and drop a non-finite one', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.setParam('drive', 0.6);
        node.setParam('drive', Number.NaN);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'drive', value: 0.6 });
    });

    it('publishes bounded schedules only for audible Toaster mix controls', async () => {
        const node = await createToasterNode(makeCtx());
        const segments = [{ startFrame: 0, endFrame: 128, startValue: 0.2, endValue: 0.8 }];
        postMessage.mockClear();

        expect(node.acceptsScheduledParam('masterGain')).toBe(true);
        expect(node.acceptsScheduledParam('reverbMix')).toBe(true);
        expect(node.acceptsScheduledParam('delayMix')).toBe(true);
        expect(node.acceptsScheduledParam('swing')).toBe(false);
        node.scheduleParam('reverbMix', segments);
        node.scheduleParam('masterGain', segments);
        node.scheduleParam('swing', segments);
        node.scheduleParam('delayMix', [
            { startFrame: 0, endFrame: 64, startValue: 0, endValue: 0.5 },
            { startFrame: 65, endFrame: 128, startValue: 0.5, endValue: 1 },
        ]);

        expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'paramAutomation', paramId: 1, segments });
        expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'paramAutomation', paramId: 0, segments });
        expect(postMessage).toHaveBeenCalledTimes(2);
        const [, ...padOutputs] = padGainNodes;
        expect(padOutputs.every((gainNode) => gainNode.gain.cancelScheduledValues.mock.calls.length === 0)).toBe(true);
        expect(padOutputs.every((gainNode) => gainNode.gain.setValueAtTime.mock.calls.length === 0)).toBe(true);
        expect(padOutputs.every((gainNode) => gainNode.gain.linearRampToValueAtTime.mock.calls.length === 0)).toBe(
            true
        );
    });

    it('should forward a finite setPadParam value and drop a non-finite one', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.setPadParam(1, 'decay', 0.3);
        node.setPadParam(1, 'decay', Number.POSITIVE_INFINITY);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'padParam', pad: 1, name: 'decay', value: 0.3 });
    });

    it('should forward valid pad dry-routing ownership changes and ignore invalid pads', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.setPadDryRouted(0, true);
        node.setPadDryRouted(15, false);
        node.setPadDryRouted(-1, true);
        node.setPadDryRouted(16, true);
        node.setPadDryRouted(1.5, true);

        expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'padDryRouted', pad: 0, routed: true });
        expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'padDryRouted', pad: 15, routed: false });
        expect(postMessage).toHaveBeenCalledTimes(2);
    });

    it('should gate noteOn and scheduleHit while bypassed, without gating noteOff', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();
        node.setBypass(true);

        node.noteOn(1, 100);
        node.scheduleHit({ pad: 1, velocity: 100, sampleFrame: 0, padParams: [] });
        expect(postMessage).not.toHaveBeenCalled();

        node.noteOff(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOff', pad: 1, sampleFrame: undefined });

        node.setBypass(false);
        node.noteOn(1, 100);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'noteOn',
            pad: 1,
            velocity: 100,
            note: 60,
            sampleFrame: undefined,
        });
    });

    it('keeps private worklet outputs connected when the parent output is rebuilt', async () => {
        const node = await createToasterNode(makeCtx());
        const dest = {} as AudioNode;
        connect.mockClear();
        disconnect.mockClear();

        node.disconnect();
        node.connect(dest);

        const [parentOutput, ...padOutputs] = padGainNodes;
        expect(padGainNodes).toHaveLength(17);
        expect(parentOutput?.disconnect).toHaveBeenCalledTimes(1);
        expect(parentOutput?.connect).toHaveBeenCalledWith(dest);
        expect(padOutputs.every((gainNode) => gainNode.disconnect.mock.calls.length === 0)).toBe(true);
        expect(connect).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();
    });

    it('routes stable pad outputs through unity routing nodes and tears them down', async () => {
        const node = await createToasterNode(makeCtx());
        const destination = {} as AudioNode;
        if (!node.connectPadOutput || !node.disconnectPadOutput) {
            throw new Error('Toaster pad output controls are missing');
        }

        expect(workletOptions?.numberOfOutputs).toBe(17);
        expect(workletOptions?.outputChannelCount).toEqual(Array.from({ length: 17 }, () => 2));
        const [parentOutput, ...padOutputs] = padGainNodes;
        expect(padGainNodes).toHaveLength(17);
        expect(parentOutput?.gain.value).toBe(1);
        expect(padOutputs.every((gainNode) => gainNode.gain.value === 1)).toBe(true);
        expect(connect).toHaveBeenNthCalledWith(1, parentOutput, 0, 0);
        expect(connect).toHaveBeenNthCalledWith(2, padOutputs[0], 1, 0);
        expect(connect).toHaveBeenNthCalledWith(17, padOutputs[15], 16, 0);

        node.connectPadOutput(0, destination);
        node.connectPadOutput(15, destination);
        node.connectPadOutput(16, destination);
        expect(padOutputs[0]?.connect).toHaveBeenCalledWith(destination);
        expect(padOutputs[15]?.connect).toHaveBeenCalledWith(destination);
        expect(connect).toHaveBeenCalledTimes(17);

        node.disconnectPadOutput(15, destination);
        expect(padOutputs[15]?.disconnect).toHaveBeenCalledWith(destination);

        postMessage.mockClear();
        node.setParam('masterGain', 1.5);
        node.setParam('masterGain', -0.25);
        node.setParam('masterGain', 0.35);
        node.setParam('masterGain', Number.NaN);
        node.setParam('master_gain', 0.6);
        expect(padOutputs.every((gainNode) => gainNode.gain.value === 1)).toBe(true);
        expect(parentOutput?.gain.value).toBe(1);
        expect(postMessage).toHaveBeenCalledTimes(4);
        expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'param', name: 'masterGain', value: 1.5 });
        expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'param', name: 'masterGain', value: -0.25 });
        expect(postMessage).toHaveBeenNthCalledWith(3, { type: 'param', name: 'masterGain', value: 0.35 });
        expect(postMessage).toHaveBeenNthCalledWith(4, { type: 'param', name: 'master_gain', value: 0.6 });

        for (const gainNode of padGainNodes) {
            gainNode.disconnect.mockClear();
        }
        node.destroy();
        expect(padGainNodes.every((gainNode) => gainNode.disconnect.mock.calls.length === 1)).toBe(true);
    });

    it('disconnects immediately but closes the port only after acknowledged disposal', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        expect(() => node.destroy()).not.toThrow();
        expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'resetPadDryRouting' });
        expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'dispose' });
        expect(disconnect).toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();

        onmessage?.({ data: { type: 'disposed' } } as MessageEvent<unknown>);

        expect(close).toHaveBeenCalledTimes(1);
    });

    it('projects stable lifecycle telemetry and invalidates it after a runtime fault', async () => {
        const node = await createToasterNode(makeCtx());
        const initMessage = postMessage.mock.calls
            .map(([message]) => message as { type?: string; sab?: SharedArrayBuffer; byteOffset?: number })
            .find((message) => message.type === 'init-sab');

        expect(initMessage?.sab).toBeInstanceOf(SharedArrayBuffer);
        expect(node.processorLifecycle()).toBeNull();

        const byteOffset = initMessage?.byteOffset ?? 0;
        const values = new Float32Array(initMessage!.sab!, byteOffset);
        const sequence = new Int32Array(initMessage!.sab!, byteOffset);
        values[TOASTER_IDX.lifecycle] = 3;
        Atomics.store(sequence, TELEMETRY_SEQ_IDX, 2);

        expect(node.processorLifecycle()).toBe('sleep');

        onmessage?.({ data: { type: 'error', message: 'wasm trap' } } as MessageEvent<unknown>);

        expect(node.processorLifecycle()).toBeNull();
    });

    it('reclaims telemetry and closes the port when Chrome terminates the processor without a dispose ack', async () => {
        const releaseSlot = vi.spyOn(telemetryAllocator, 'releaseSlot');
        const onFault = vi.fn();
        const node = await createToasterNode(makeCtx(), undefined, onFault);

        node.workletNode.onprocessorerror?.(new ErrorEvent('processorerror'));

        expect(node.processorLifecycle()).toBeNull();
        expect(onFault).toHaveBeenCalledWith('ToasterNode worklet processor failed');
        expect(onFault).toHaveBeenCalledTimes(1);
        expect(releaseSlot).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);

        node.destroy();
        expect(releaseSlot).toHaveBeenCalledTimes(1);
    });

    it('reclaims telemetry when the owning context closes before disposal can be acknowledged', async () => {
        const releaseSlot = vi.spyOn(telemetryAllocator, 'releaseSlot');
        const node = await createToasterNode(makeCtx());

        contextState = 'closed';
        stateChangeListener?.(new Event('statechange'));

        expect(node.processorLifecycle()).toBeNull();
        expect(releaseSlot).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('initializes telemetry before WASM and releases its slot exactly once after disposal', async () => {
        const releaseSlot = vi.spyOn(telemetryAllocator, 'releaseSlot');
        const node = await createToasterNode(makeCtx());
        const messageTypes = postMessage.mock.calls.map(([message]) => (message as { type?: string }).type);

        expect(messageTypes.slice(0, 2)).toEqual(['init-sab', 'init']);

        postMessage.mockClear();
        node.destroy();
        node.destroy();

        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'resetPadDryRouting' });
        expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'dispose' });
        expect(releaseSlot).not.toHaveBeenCalled();
        expect(node.processorLifecycle()).toBeNull();

        onmessage?.({ data: { type: 'disposed' } } as MessageEvent<unknown>);

        expect(releaseSlot).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createToasterNode(makeCtx());

        expect(node.workletNode).toBeDefined();
        expect(node.outputNode).toBe(padGainNodes[0]);
        await expect(node.ready).resolves.toEqual({});
    });
});
