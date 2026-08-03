import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createFermenterNode, isFermenterDevice } from '../FermenterNode';
import { FERMENTER_IDX, TELEMETRY_SEQ_IDX } from '../telemetryAllocator';

function isInitSabMessage(value: unknown): value is { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        value.type === 'init-sab' &&
        'sab' in value &&
        value.sab instanceof SharedArrayBuffer &&
        'byteOffset' in value &&
        typeof value.byteOffset === 'number'
    );
}

describe('isFermenterDevice', () => {
    it('should return true only for the fermenter device type string', () => {
        expect(isFermenterDevice('fermenter')).toBe(true);
        expect(isFermenterDevice('levain')).toBe(false);
    });
});

// Mock the worklet-init helpers so createFermenterNode resolves without a real
// AudioContext / worklet module / WASM fetch. The ready handshake resolves
// immediately so the factory completes.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        // vi.fn so callers can assert the port onmessage delegates here.
        onMessage: vi.fn(() => 'ready' as const),
        isSettled: () => true,
    })),
}));

vi.mock('../../services/fermenterProcessor.ts?worker&url', () => ({ default: 'fermenter-processor-url' }));

// Bypass-entry voice release is owned by TrackNode.updateBypass, which calls
// `controller.allNotesOff()` when entering bypass. The node must therefore
// expose an `allNotesOff` surface posting the single worklet message the
// Fermenter processor honors (same message the transport-stop path posts) —
// without it, TrackNode's mechanism cannot cover Fermenter and held voices
// keep sounding through bypass.
describe('createFermenterNode allNotesOff surface', () => {
    let postMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessage = vi.fn();
        const port = { postMessage, onmessage: null, close: vi.fn() };
        class FakeWorkletNode {
            port = port;
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('posts the allNotesOff worklet message', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear(); // drop the init postMessage

        result.allNotesOff();

        expect(postMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });
    });

    it('setBypass only gates new notes — release is TrackNode-owned, no in-node post', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear();

        result.setBypass(true);

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('posts validated frame-addressed parameter automation as one worklet message', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear();
        const segments = [{ startFrame: 0, endFrame: 48_000, startValue: 200, endValue: 2_000 }];
        if (!result.scheduleParam || !result.acceptsScheduledParam) {
            throw new Error('Expected Fermenter automation controls');
        }

        result.scheduleParam('filterCutoff', segments);

        expect(result.acceptsScheduledParam('filterCutoff')).toBe(true);
        expect(result.acceptsScheduledParam('missing')).toBe(false);
        expect(postMessage).toHaveBeenCalledWith({ type: 'paramAutomation', paramId: 1, segments });

        postMessage.mockClear();
        result.scheduleParam('constructor', segments);

        expect(result.acceptsScheduledParam('constructor')).toBe(false);
        expect(postMessage).not.toHaveBeenCalled();
    });
});

// Full surface coverage: noteOn gating/clamping, noteOff, setParam finite/array
// rejection, setPatch, onTelemetry fan-out, the port onmessage telemetry vs
// handshake dispatch branch, connect/disconnect/destroy (incl. swallow path),
// and the suspended-AudioContext resume branch at factory entry.
describe('createFermenterNode message surface & lifecycle', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let onmessageRef: { current: ((event: MessageEvent) => void) | null };

    beforeEach(() => {
        postMessage = vi.fn();
        onmessageRef = { current: null };
        const port = {
            postMessage,
            close: vi.fn(),
            set onmessage(fn: (event: MessageEvent) => void) {
                onmessageRef.current = fn;
            },
            get onmessage(): ((event: MessageEvent) => void) | null {
                return onmessageRef.current;
            },
        };
        class FakeWorkletNode {
            port = port;
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    async function makeNode() {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        return createFermenterNode(ctx);
    }

    it('noteOn clamps velocity and forwards valid MIDI notes, including sampleFrame', async () => {
        const result = await makeNode();
        postMessage.mockClear();

        result.noteOn(60, 200, 12345);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'noteOn',
            note: 60,
            velocity: 127,
            sampleFrame: 12345,
        });

        result.noteOn(48, -10);
        expect(postMessage).toHaveBeenLastCalledWith({
            type: 'noteOn',
            note: 48,
            velocity: 0,
            sampleFrame: undefined,
        });
    });

    it('noteOn is suppressed by out-of-range notes and by bypass', async () => {
        const result = await makeNode();
        postMessage.mockClear();

        result.noteOn(-1, 100); // below range
        result.noteOn(128, 100); // at/above range
        expect(postMessage).not.toHaveBeenCalled();

        result.setBypass(true);
        result.noteOn(60, 100); // valid note but bypassed
        expect(postMessage).not.toHaveBeenCalled();

        result.setBypass(false);
        result.noteOn(60, 100);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('noteOff forwards the note (no range gate) with optional sampleFrame', async () => {
        const result = await makeNode();
        postMessage.mockClear();

        result.noteOff(72, 99);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOff', note: 72, sampleFrame: 99 });
    });

    it('setParam forwards finite numbers and arrays, rejects NaN/Infinity', async () => {
        const result = await makeNode();
        postMessage.mockClear();

        result.setParam('cutoff', 440, 5);
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'cutoff', value: 440, sampleFrame: 5 });

        result.setParam('oscLevels', [0.1, 0.2]);
        expect(postMessage).toHaveBeenLastCalledWith({
            type: 'param',
            name: 'oscLevels',
            value: [0.1, 0.2],
            sampleFrame: undefined,
        });

        result.setParam('bad', Number.NaN);
        result.setParam('bad2', Number.POSITIVE_INFINITY);
        // Only the two valid calls forwarded.
        expect(postMessage).toHaveBeenCalledTimes(2);
    });

    it('setPatch forwards the patch object', async () => {
        const result = await makeNode();
        postMessage.mockClear();
        const patch = { waveform: 'saw', octave: 2 };

        result.setPatch(patch);

        expect(postMessage).toHaveBeenCalledWith({ type: 'patch', patch });
    });

    it('onmessage hands non-telemetry events to the ready handshake', async () => {
        await makeNode();
        const handshake = await import('#/infra/audioWorklet/workletInitShared');
        const { createReadyHandshake } = vi.mocked(handshake);
        // The factory calls createReadyHandshake exactly once; grab its result.
        const handshakeResult = createReadyHandshake.mock.results.at(-1)?.value as {
            onMessage: ReturnType<typeof vi.fn>;
        };
        expect(handshakeResult.onMessage).toBeTypeOf('function');

        onmessageRef.current!({ data: { type: 'ready' } } as MessageEvent);
        expect(handshakeResult.onMessage).toHaveBeenCalledTimes(1);
    });

    it('projects the processor lifecycle from the shared telemetry snapshot', async () => {
        const result = await makeNode();
        const initMessage = (postMessage.mock.calls as unknown[][]).map(([message]) => message).find(isInitSabMessage);
        if (initMessage === undefined) {
            throw new Error('Expected Fermenter telemetry initialization');
        }
        const floats = new Float32Array(initMessage.sab, initMessage.byteOffset);
        const ints = new Int32Array(initMessage.sab, initMessage.byteOffset);
        floats[FERMENTER_IDX.lifecycle] = 3;
        Atomics.store(ints, TELEMETRY_SEQ_IDX, 2);

        expect(result.processorLifecycle()).toBe('sleep');

        onmessageRef.current!({ data: { type: 'error', message: 'render trap' } } as MessageEvent);
        expect(result.processorLifecycle()).toBeNull();
    });

    it('connect/disconnect/destroy drive the underlying worklet node', async () => {
        const result = await makeNode();
        // connect delegates to node.connect
        const dest = {} as AudioNode;
        result.connect(dest);
        // destroy disconnects then closes the port; calling disconnect after
        // must swallow the (re-)disconnect error.
        result.destroy();
        // Now disconnect() should catch without throwing.
        expect(() => result.disconnect()).not.toThrow();
    });

    it('resume()s a suspended AudioContext at factory entry, but skips OfflineAudioContext', async () => {
        // Suspended AudioContext: resume should be awaited.
        const resume = vi.fn().mockResolvedValue(undefined);
        const suspendedCtx = {
            currentTime: 0,
            state: 'suspended',
            resume,
        } as unknown as AudioContext;
        // AudioContext is a stubbed global in jsdom? It may not exist. Stub it
        // so `instanceof AudioContext` is true for the fake context.
        class FakeAudioContext {}
        vi.stubGlobal('AudioContext', FakeAudioContext);
        // Re-assign prototype so instanceof holds.
        Object.setPrototypeOf(suspendedCtx, FakeAudioContext.prototype);

        await createFermenterNode(suspendedCtx);
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('aborts WASM fetching before allocating an AudioWorkletNode', async () => {
        const workletInit = await import('#/infra/audioWorklet/workletInitShared');
        vi.mocked(workletInit.fetchWasmModule).mockImplementationOnce(
            () => new Promise<Awaited<ReturnType<typeof workletInit.fetchWasmModule>>>(() => {})
        );
        const allocation = vi.fn();
        class CountingWorkletNode {
            constructor() {
                allocation();
            }
        }
        vi.stubGlobal('AudioWorkletNode', CountingWorkletNode);
        const abortController = new AbortController();
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        const pending = createFermenterNode(ctx, undefined, abortController.signal);
        abortController.abort(new DOMException('Timed out', 'AbortError'));

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(allocation).not.toHaveBeenCalled();
    });

    it('observes a WASM rejection when cancellation lands after worklet registration', async () => {
        const workletInit = await import('#/infra/audioWorklet/workletInitShared');
        const abortController = new AbortController();
        const abortReason = new DOMException('Cancelled after registration', 'AbortError');
        const fetchFailure = new Error('late fetch failure');
        const rejectedFetch = Promise.reject<Awaited<ReturnType<typeof workletInit.fetchWasmModule>>>(fetchFailure);
        const observeFetchRejection = vi.spyOn(rejectedFetch, 'catch');
        vi.mocked(workletInit.fetchWasmModule).mockImplementationOnce(() => {
            abortController.abort(abortReason);
            return rejectedFetch;
        });
        const allocation = vi.fn();
        class CountingWorkletNode {
            constructor() {
                allocation();
            }
        }
        vi.stubGlobal('AudioWorkletNode', CountingWorkletNode);
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        const pending = createFermenterNode(ctx, undefined, abortController.signal);
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

        expect(observeFetchRejection).toHaveBeenCalledOnce();
        expect(allocation).not.toHaveBeenCalled();
    });

    it('releases an uncommitted module lease when AudioWorkletNode construction fails', async () => {
        const workletInit = await import('#/infra/audioWorklet/workletInitShared');
        const commit = vi.fn();
        const release = vi.fn();
        vi.mocked(workletInit.fetchWasmModule).mockResolvedValueOnce({
            module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
            commit,
            release,
        });
        class ThrowingWorkletNode {
            constructor() {
                throw new Error('processor construction failed');
            }
        }
        vi.stubGlobal('AudioWorkletNode', ThrowingWorkletNode);
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        await expect(createFermenterNode(ctx)).rejects.toThrow('processor construction failed');
        expect(release).toHaveBeenCalledOnce();
        expect(commit).not.toHaveBeenCalled();
    });

    it('commits the module lease after AudioWorkletNode construction succeeds', async () => {
        const workletInit = await import('#/infra/audioWorklet/workletInitShared');
        const commit = vi.fn();
        const release = vi.fn();
        vi.mocked(workletInit.fetchWasmModule).mockResolvedValueOnce({
            module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
            commit,
            release,
        });
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        await createFermenterNode(ctx);

        expect(commit).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
    });

    it('rechecks cancellation at the resource-allocation boundary', async () => {
        const allocation = vi.fn();
        class CountingWorkletNode {
            constructor() {
                allocation();
            }
        }
        vi.stubGlobal('AudioWorkletNode', CountingWorkletNode);
        const boundaryAbort = new DOMException('Cancelled at boundary', 'AbortError');
        const throwIfAborted = vi.fn(() => {
            throw boundaryAbort;
        });
        const signal = {
            aborted: false,
            reason: undefined,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            throwIfAborted,
        } as unknown as AbortSignal;
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        await expect(createFermenterNode(ctx, undefined, signal)).rejects.toBe(boundaryAbort);
        expect(throwIfAborted).toHaveBeenCalledTimes(1);
        expect(allocation).not.toHaveBeenCalled();
    });
});
