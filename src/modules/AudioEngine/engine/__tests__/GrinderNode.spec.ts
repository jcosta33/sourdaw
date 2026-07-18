import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createGrinderNode, isGrinderDevice } from '../GrinderNode';

// Mock the worklet-init helpers so createGrinderNode resolves without a real
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

// SAB requirement is satisfied in the test environment; make it a no-op so the
// factory does not throw before reaching setParam.
vi.mock('../pluginHostingErrors', () => ({
    requireSharedArrayBuffer: vi.fn(),
}));

// No telemetry slot needed for the param-coalescing path.
vi.mock('../telemetryAllocator', () => ({
    telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() },
    GRINDER_IDX: {},
}));

vi.mock('../../services/grinderProcessor.ts?worker&url', () => ({ default: 'grinder-processor-url' }));

describe('isGrinderDevice', () => {
    it('should return true only for the grinder device type string', () => {
        expect(isGrinderDevice('grinder')).toBe(true);
        expect(isGrinderDevice('proof')).toBe(false);
    });
});

// ── Fix 9: message-port params coalesce per animation frame ──
//
// A param with no backing AudioParam is forwarded to the worklet via
// postMessage. A rapid knob drag or automation sweep fires setParam many times
// per frame; without coalescing each call is its own structured-clone post,
// flooding the port. The node must buffer the latest value per name and flush
// once per requestAnimationFrame.
describe('GrinderNode setParam coalescing', () => {
    let rafCallbacks: FrameRequestCallback[];
    let postMessage: ReturnType<typeof vi.fn>;
    let parameters: Map<string, unknown>;

    beforeEach(() => {
        rafCallbacks = [];
        postMessage = vi.fn();
        // Empty parameters map → every setParam takes the postMessage path.
        parameters = new Map();

        class FakeWorkletNode {
            port = { postMessage, onmessage: null, close: vi.fn() };
            parameters = parameters;
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal(
            'SharedArrayBuffer',
            class extends ArrayBuffer {
                constructor(length: number) {
                    super(length);
                }
            }
        );
        // Capture rAF callbacks so the test controls when a frame flushes.
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        // Grinder fetches its WASM via its own fetcher; return a valid response.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function flushFrame(): void {
        const cbs = rafCallbacks.splice(0);
        for (const cb of cbs) {
            cb(performance.now());
        }
    }

    async function makeNode() {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        return createGrinderNode(ctx);
    }

    it('collapses repeated posts of one param into a single post per frame', async () => {
        const node = await makeNode();
        postMessage.mockClear(); // ignore the init post

        // A rapid sweep: many setParam calls within one frame.
        node.setParam('drive', 0.1);
        node.setParam('drive', 0.4);
        node.setParam('drive', 0.9);

        // Nothing posted yet — buffered until the frame flush.
        const paramPostsBeforeFrame = postMessage.mock.calls.filter(
            (c) => (c[0] as { type?: string })?.type === 'param'
        );
        expect(paramPostsBeforeFrame.length).toBe(0);

        flushFrame();

        // Exactly one post, carrying the LAST value of the sweep.
        const paramPosts = postMessage.mock.calls.filter((c) => (c[0] as { type?: string })?.type === 'param');
        expect(paramPosts.length).toBe(1);
        expect(paramPosts[0]![0]).toEqual({ type: 'param', name: 'drive', value: 0.9 });
    });

    it('posts the latest value per distinct param name in one frame', async () => {
        const node = await makeNode();
        postMessage.mockClear();

        node.setParam('drive', 0.5);
        node.setParam('tone', 0.2);
        node.setParam('drive', 0.7);

        flushFrame();

        const paramPosts = postMessage.mock.calls
            .filter((c) => (c[0] as { type?: string })?.type === 'param')
            .map((c) => c[0]);
        expect(paramPosts).toContainEqual({ type: 'param', name: 'drive', value: 0.7 });
        expect(paramPosts).toContainEqual({ type: 'param', name: 'tone', value: 0.2 });
        expect(paramPosts.length).toBe(2);
    });
});
