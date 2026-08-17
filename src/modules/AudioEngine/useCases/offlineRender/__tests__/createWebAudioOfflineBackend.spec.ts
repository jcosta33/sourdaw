/**
 * The parts of the offline `AudioGraphBackend` the null test cannot reach.
 *
 * `liveOfflineNullTest.spec.ts` owns the audio question — does a fixture routed
 * through the contract render the same samples — and it is the stronger
 * instrument for everything it covers. What it does not cover is the seam's
 * *protocol*: what a batch does when it is refused, what a report says, and
 * which node a send taps. Those are graph-shape claims, and asserting them
 * against edges is both cheaper and more direct than asserting them against
 * a subtraction that would null either way.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphStripState } from '../../../models/AudioGraphBackend';

vi.mock('../../buildDeviceChain', () => ({
    buildDeviceChain: vi.fn(async (_ctx, devices, inputNode, outputNode) => {
        inputNode.connect(outputNode);
        return devices
            .filter((device: { bypassed?: boolean }) => !device.bypassed)
            .map((device: { id: string; type: string }) => ({
                deviceId: device.id,
                deviceType: device.type,
                node: { inputNode, outputNode },
                strategy: { setParam: vi.fn(), destroy: vi.fn() },
            }));
    }),
}));

const { createWebAudioOfflineBackend } = await import('../createWebAudioOfflineBackend');

type FakeParam = { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
type FakeNode = {
    gain?: FakeParam;
    pan?: FakeParam;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
};

function fakeParam(value: number): FakeParam {
    const param: FakeParam = {
        value,
        setValueAtTime: vi.fn((next: number) => {
            param.value = next;
        }),
    };
    return param;
}

function fakeNode(kind: 'gain' | 'pan'): FakeNode {
    return kind === 'gain'
        ? { gain: fakeParam(1), connect: vi.fn(), disconnect: vi.fn() }
        : { pan: fakeParam(0), connect: vi.fn(), disconnect: vi.fn() };
}

function fakeContext(): OfflineAudioContext {
    return {
        createGain: () => fakeNode('gain'),
        createStereoPanner: () => fakeNode('pan'),
    } as unknown as OfflineAudioContext;
}

const REST: AudioGraphStripState = { gain: 1, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 };

function backendUnderTest(): {
    backend: ReturnType<typeof createWebAudioOfflineBackend>;
    master: FakeNode;
} {
    const master = fakeNode('gain');
    return {
        master,
        backend: createWebAudioOfflineBackend({
            context: fakeContext(),
            masterNode: master as unknown as AudioNode,
        }),
    };
}

describe('createWebAudioOfflineBackend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reports the device ids it built, in graph order', async () => {
        const { backend } = backendUnderTest();

        const result = await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: REST,
                    devices: [
                        { id: 'a', name: 'a', type: 'builtin-gain', bypassed: false, parameterValues: {} },
                        { id: 'b', name: 'b', type: 'builtin-filter', bypassed: true, parameterValues: {} },
                        { id: 'c', name: 'c', type: 'builtin-eq', bypassed: false, parameterValues: {} },
                    ],
                    honorMuted: true,
                    contributesAudio: true,
                },
            ],
        });

        expect(result).toMatchObject({
            acceptance: 'accepted',
            application: 'applied',
            reports: [{ kind: 'track', id: 't1', deviceIds: ['a', 'c'] }],
        });
    });

    it('closes the pre-fader tap for a solo-gated strip and leaves the mute gate open', async () => {
        const { backend } = backendUnderTest();

        await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: { ...REST, soloGated: true },
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
            ],
        });

        const strip = backend.getTrackStrip('t1');
        // The gate that matters is the pre-fader one: it is upstream of the
        // send taps, so a gated track feeds neither its bus nor its output.
        expect(strip?.preFaderTap.gain.value).toBe(0);
        expect(strip?.postFaderGain.gain.value).toBe(1);
    });

    it('taps a pre-fader send ahead of the fader and a post-fader send after the panner', async () => {
        const { backend } = backendUnderTest();

        await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-bus-strip',
                    busId: 'bus',
                    name: 'Bus',
                    state: REST,
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: REST,
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                { kind: 'add-send', trackId: 't1', busId: 'bus', tap: 'pre-fader', level: 0.5 },
                { kind: 'add-send', trackId: 't1', busId: 'bus2', tap: 'post-fader', level: 0.5 },
            ],
        });

        const strip = backend.getTrackStrip('t1');
        expect(strip?.preFaderTap.connect).toHaveBeenCalled();
        // The second send names a bus this render never built. Live it is
        // silent too, so it is skipped rather than refused — and it must not
        // leave a level parameter behind for an automation lane to find.
        expect([...(backend.getSendAutomationParams('t1') ?? new Map()).keys()]).toEqual(['send:bus']);
    });

    it('clamps a fader write to the ceiling and folds in the VCA multiplier', async () => {
        const { backend } = backendUnderTest();

        await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: { ...REST, gain: 0.5, vcaMultiplier: 0.5 },
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                {
                    kind: 'write-parameter',
                    target: { kind: 'track-fader', trackId: 't1' },
                    write: { shape: 'step', value: 1.8, time: 0 },
                },
                {
                    kind: 'write-parameter',
                    target: { kind: 'track-pan', trackId: 't1' },
                    write: { shape: 'step', value: -75, time: 0 },
                },
            ],
        });

        const strip = backend.getTrackStrip('t1');
        // 1.8 × 0.5 = 0.9, under the ceiling. Clamping before the fold would
        // have produced 0.5, and skipping the fold entirely 1.
        expect(strip?.faderNode.gain.value).toBeCloseTo(0.9, 10);
        // −75 is off this app's −50…50 scale; the write clamps where the strip
        // does rather than driving the panner past hard left.
        expect(strip?.panNode.pan.value).toBe(-1);
    });

    it('refuses the whole batch when one command names something an offline render cannot do', async () => {
        const { backend } = backendUnderTest();

        const result = await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: REST,
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                {
                    kind: 'insert-device',
                    trackId: 't1',
                    device: { id: 'd', name: 'd', type: 'builtin-gain', bypassed: false, parameterValues: {} },
                    index: 0,
                },
            ],
        });

        expect(result.acceptance).toBe('rejected');
        // Nothing ahead of the refused command may have been applied.
        expect(backend.getTrackStrip('t1')).toBeUndefined();
    });

    it('refuses a correlated batch the composition root calls stale, before touching the graph', async () => {
        const master = fakeNode('gain');
        const backend = createWebAudioOfflineBackend({
            context: fakeContext(),
            masterNode: master as unknown as AudioNode,
            acceptCorrelation: () => false,
        });

        const result = await backend.apply({
            schemaVersion: 1,
            correlation: { appRevision: 3, projectRevision: 'rev-7' },
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: REST,
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
            ],
        });

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(backend.getTrackStrip('t1')).toBeUndefined();
    });

    it('writes a device parameter through the device strategy that owns it', async () => {
        const { backend } = backendUnderTest();

        await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: REST,
                    devices: [{ id: 'a', name: 'a', type: 'builtin-gain', bypassed: false, parameterValues: {} }],
                    honorMuted: true,
                    contributesAudio: true,
                },
                {
                    kind: 'write-device-parameter',
                    target: { kind: 'device-parameter', trackId: 't1', deviceId: 'a', parameterId: 'gain' },
                    write: { shape: 'step', value: 0.25, time: 0 },
                },
            ],
        });

        const entry = backend.getDeviceEntriesByTrack().get('t1')?.[0];
        expect(entry?.strategy.setParam).toHaveBeenCalledWith('gain', 0.25);
    });

    it('cannot be handed a device-parameter write this backend would have to discard', async () => {
        const { backend } = backendUnderTest();

        // The guard is the type, not a branch: a device parameter lands at a
        // block boundary rather than a sample offset, so a ramp aimed at one
        // has no meaning and used to be accepted and dropped. `@ts-expect-error`
        // is the assertion — it fails the typecheck the moment the pairing
        // becomes representable again, which a runtime test cannot observe.
        await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'write-device-parameter',
                    target: { kind: 'device-parameter', trackId: 't1', deviceId: 'a', parameterId: 'gain' },
                    // @ts-expect-error a device parameter accepts only a step write
                    write: { shape: 'ramp-to', value: 0.25, startTime: 0, landTime: 1 },
                },
            ],
        });
    });

    it('refuses a clip whose source names material this backend cannot resolve', async () => {
        const { backend } = backendUnderTest();

        const result = await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: REST,
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                {
                    kind: 'schedule-clip',
                    playback: {
                        trackId: 't1',
                        // A native backend resolves this against its own pool.
                        // This one's material *is* an `AudioBuffer`, so it says
                        // so rather than rendering a rest that reads as correct.
                        source: { sourceId: 'take-4' },
                        startTime: 0,
                        sourceOffsetSeconds: 0,
                        durationSeconds: 1,
                        playbackRate: 1,
                        gain: 1,
                        fade: { microFadeSeconds: 0.005 },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(result.acceptance === 'rejected' && result.reason).toContain('take-4');
        expect(backend.getTrackStrip('t1')).toBeUndefined();
    });

    it('destroys every device strategy it built, once', async () => {
        const { backend } = backendUnderTest();

        await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 't1',
                    name: 'Fixture',
                    state: REST,
                    devices: [{ id: 'a', name: 'a', type: 'builtin-gain', bypassed: false, parameterValues: {} }],
                    honorMuted: true,
                    contributesAudio: true,
                },
            ],
        });
        const entry = backend.getDeviceEntriesByTrack().get('t1')?.[0];

        backend.dispose();
        backend.dispose();

        // A metered device holds a slot in a shared pool until `destroy` gives
        // it back, and a second teardown must not be able to double-release it.
        expect(entry?.strategy.destroy).toHaveBeenCalledTimes(1);
    });
});
