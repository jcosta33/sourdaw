import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createToasterNode, isToasterDevice } from '../ToasterNode';

// Mock the worklet-init helpers so createToasterNode resolves without a real
// AudioContext / worklet module / WASM fetch. The ready handshake resolves
// immediately so the factory's `await` chain completes.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'other' as const,
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
    let workletOptions: AudioWorkletNodeOptions | undefined;

    beforeEach(() => {
        postMessage = vi.fn();
        disconnect = vi.fn();
        connect = vi.fn();
        close = vi.fn();
        resume = vi.fn().mockResolvedValue(undefined);
        workletOptions = undefined;

        class FakeWorkletNode {
            constructor(_context: BaseAudioContext, _name: string, options?: AudioWorkletNodeOptions) {
                workletOptions = options;
            }
            port = { postMessage, onmessage: null as ((e: MessageEvent) => void) | null, close };
            connect = connect;
            disconnect = disconnect;
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function makeCtx(state: 'running' | 'suspended' = 'running') {
        class FakeAudioContext {
            state = state;
            resume = resume;
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

    it('should forward a finite setPadParam value and drop a non-finite one', async () => {
        const node = await createToasterNode(makeCtx());
        postMessage.mockClear();

        node.setPadParam(1, 'decay', 0.3);
        node.setPadParam(1, 'decay', Number.POSITIVE_INFINITY);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'padParam', pad: 1, name: 'decay', value: 0.3 });
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

    it('should connect to the destination and swallow a disconnect error instead of throwing', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createToasterNode(makeCtx());
        const dest = {} as AudioNode;

        node.connect(dest);
        expect(connect).toHaveBeenCalledWith(dest);
        expect(() => node.disconnect()).not.toThrow();
    });

    it('exposes one parent and 16 stereo pad outputs through stable output indexes', async () => {
        const node = await createToasterNode(makeCtx());
        const destination = {} as AudioNode;
        if (!node.connectPadOutput || !node.disconnectPadOutput) {
            throw new Error('Toaster pad output controls are missing');
        }

        expect(workletOptions?.numberOfOutputs).toBe(17);
        expect(workletOptions?.outputChannelCount).toEqual(Array.from({ length: 17 }, () => 2));
        node.connectPadOutput(0, destination);
        node.connectPadOutput(15, destination);
        node.connectPadOutput(16, destination);
        expect(connect).toHaveBeenNthCalledWith(1, destination, 1, 0);
        expect(connect).toHaveBeenNthCalledWith(2, destination, 16, 0);
        expect(connect).toHaveBeenCalledTimes(2);

        node.disconnectPadOutput(15, destination);
        expect(disconnect).toHaveBeenCalledWith(destination, 16, 0);
    });

    it('should disconnect and close the port on destroy, swallowing a disconnect error', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createToasterNode(makeCtx());

        expect(() => node.destroy()).not.toThrow();
        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createToasterNode(makeCtx());

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });
});
