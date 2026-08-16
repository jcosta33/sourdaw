/**
 * Native plugin bridge transport.
 *
 * Exercises the real relay: worklet block → main thread → host → processed
 * bytes → worklet. The host is faked at the Plugin use-case seam and keyed by
 * instance id, exactly as `process_plugin_audio` keys it, so a block addressed
 * to an instance the host does not know degrades the way production does.
 *
 * That degradation is the defect this spec was written against. The relay used
 * to address the host by a numeric engine plugin id, which is reserved inside
 * the Rust audio engine (ids start at 1000) and never reaches the frontend —
 * the call site passed a hardcoded 0. `process_plugin_audio` resolved no bridge,
 * the error was swallowed to null, and the worklet emitted the dry input
 * forever: a plugin sitting in the rack, reporting active, changing nothing.
 * Keying by instance id removes the mismatched identifier from the wire, so the
 * failure is no longer representable rather than merely corrected.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processAudioIPC, setPluginBypass } from '#/modules/PluginHost/useCases';

import { createNativePluginBridgeNode } from '../NativePluginBridgeNode';

vi.mock('#/modules/PluginHost/useCases', () => ({
    processAudioIPC: vi.fn(),
    setPluginBypass: vi.fn(),
    setPluginParameter: vi.fn(),
}));

type BridgeMessage = { type: string; audio?: ArrayBuffer };

class FakeMessagePort {
    public onmessage: ((event: MessageEvent<BridgeMessage>) => Promise<void> | void) | null = null;
    public readonly close = vi.fn();
    public readonly postMessage = vi.fn();
}

class FakeAudioWorkletNode {
    public static instances: FakeAudioWorkletNode[] = [];
    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();
    public readonly port = new FakeMessagePort();

    public constructor() {
        FakeAudioWorkletNode.instances.push(this);
    }
}

/**
 * Stand-in for the native host. Only instances it has registered resolve a
 * bridge; anything else returns null, which is what the frontend observes when
 * `process_plugin_audio` cannot resolve the key it was handed.
 */
function createFakeHost(registeredInstanceIds: string[], gain: number) {
    const registered = new Set(registeredInstanceIds);
    const seenInstanceIds: string[] = [];

    vi.mocked(processAudioIPC).mockImplementation(({ instanceId, audioBytes }) => {
        seenInstanceIds.push(instanceId);
        if (!registered.has(instanceId)) {
            return Promise.resolve(null);
        }
        const samples = new Float32Array(audioBytes.slice().buffer);
        const processed = samples.map((sample) => sample * gain);
        return Promise.resolve(new Uint8Array(processed.buffer));
    });

    return { seenInstanceIds };
}

function interleavedBytes(frames: Array<[number, number]>): ArrayBuffer {
    const samples = new Float32Array(frames.length * 2);
    for (const [index, [left, right]] of frames.entries()) {
        samples[index * 2] = left;
        samples[index * 2 + 1] = right;
    }
    return samples.buffer;
}

function currentNode(): FakeAudioWorkletNode {
    const node = FakeAudioWorkletNode.instances.at(-1);
    if (!node) {
        throw new Error('expected the bridge worklet node to be created');
    }
    return node;
}

async function relayBlock(node: FakeAudioWorkletNode, audio: ArrayBuffer): Promise<void> {
    await node.port.onmessage?.(new MessageEvent<BridgeMessage>('message', { data: { type: 'process', audio } }));
}

function processedSamples(node: FakeAudioWorkletNode): number[] {
    const posted = node.port.postMessage.mock.calls.find(
        (call) => (call[0] as BridgeMessage).type === 'processed'
    )?.[0] as BridgeMessage | undefined;
    if (!posted?.audio) {
        return [];
    }
    return Array.from(new Float32Array(posted.audio));
}

describe('native plugin bridge transport', () => {
    beforeEach(() => {
        FakeAudioWorkletNode.instances = [];
        vi.stubGlobal('AudioContext', class {});
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.clearAllMocks();
    });

    it('addresses the host by instance id and returns the processed audio to the worklet', async () => {
        const host = createFakeHost(['instance-1'], 2);
        await createNativePluginBridgeNode(new AudioContext(), 'instance-1');
        const node = currentNode();

        await relayBlock(
            node,
            interleavedBytes([
                [0.25, -0.25],
                [0.5, -0.5],
            ])
        );

        expect(host.seenInstanceIds).toEqual(['instance-1']);
        expect(processedSamples(node)).toEqual([0.5, -0.5, 1, -1]);
    });

    it('leaves the worklet on dry passthrough when the host cannot resolve the instance', async () => {
        // The pre-fix failure mode, kept as a live assertion: an unresolvable
        // key must produce no processed block, so the worklet keeps emitting
        // its input rather than silently emitting processed-looking audio.
        const host = createFakeHost(['instance-known'], 2);
        await createNativePluginBridgeNode(new AudioContext(), 'instance-unknown');
        const node = currentNode();

        await relayBlock(node, interleavedBytes([[0.25, -0.25]]));

        expect(host.seenInstanceIds).toEqual(['instance-unknown']);
        expect(processedSamples(node)).toEqual([]);
    });

    it('never sends a numeric placeholder identity to the host', async () => {
        createFakeHost(['instance-1'], 2);
        await createNativePluginBridgeNode(new AudioContext(), 'instance-1');
        const node = currentNode();

        await relayBlock(node, interleavedBytes([[0.25, -0.25]]));

        const [request] = vi.mocked(processAudioIPC).mock.calls[0] ?? [];
        expect(request?.instanceId).toBe('instance-1');
        // The init handshake carries no plugin identity at all — the worklet has
        // no id to get wrong. It carries only the shared dropout tally.
        const init = node.port.postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(init.type).toBe('init');
        expect(Object.keys(init).sort()).toEqual(['dropoutSab', 'type']);
    });

    it('carries a bypass toggle to the native graph instead of dropping it', async () => {
        // The bypass used to stop at this controller with nothing behind it, so
        // the Rust-side plugin kept processing whatever still reached it while
        // the rack showed it bypassed.
        vi.mocked(setPluginBypass).mockResolvedValue();
        const bridge = await createNativePluginBridgeNode(new AudioContext(), 'instance-1');

        bridge.setBypass(true);
        bridge.setBypass(false);

        expect(vi.mocked(setPluginBypass).mock.calls.map(([input]) => input)).toEqual([
            { instanceId: 'instance-1', bypassed: true },
            { instanceId: 'instance-1', bypassed: false },
        ]);
    });

    it('survives a native graph that refuses the bypass', async () => {
        // A refusal here is a control-path failure, not an audio one: the
        // WebAudio chain rebuild still takes the device out of the path, so the
        // user's bypass holds. Rejecting into an unhandled promise would take
        // the surrounding UI call with it.
        vi.mocked(setPluginBypass).mockRejectedValue(new Error('Native engine not running'));
        const bridge = await createNativePluginBridgeNode(new AudioContext(), 'instance-1');

        expect(() => bridge.setBypass(true)).not.toThrow();
        await Promise.resolve();
    });

    it('keeps one block in flight and resumes relaying after the host answers', async () => {
        let releaseHost: ((bytes: Uint8Array) => void) | undefined;
        vi.mocked(processAudioIPC).mockReturnValue(
            new Promise((resolve) => {
                releaseHost = resolve;
            })
        );
        await createNativePluginBridgeNode(new AudioContext(), 'instance-1');
        const node = currentNode();

        const first = relayBlock(node, interleavedBytes([[0.25, 0.25]]));
        await relayBlock(node, interleavedBytes([[0.75, 0.75]]));

        // The second block is dropped rather than queued: the relay must not
        // grow an unbounded backlog behind a slow host.
        expect(processAudioIPC).toHaveBeenCalledTimes(1);

        const answer = new Float32Array([0.125, 0.125]);
        releaseHost?.(new Uint8Array(answer.buffer));
        await first;
        expect(processedSamples(node)).toEqual([0.125, 0.125]);

        await relayBlock(node, interleavedBytes([[0.5, 0.5]]));
        expect(processAudioIPC).toHaveBeenCalledTimes(2);
    });
});
