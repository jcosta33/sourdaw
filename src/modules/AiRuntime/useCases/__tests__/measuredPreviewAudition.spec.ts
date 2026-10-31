import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Audio = typeof import('#/modules/AudioEngine/useCases');
let audio: Audio;
let agentMeasurementArtifactStore: typeof import('#/modules/AudioRendering/stores').agentMeasurementArtifactStore;
let measuredPreviewAuditionStore: typeof import('../../stores/measuredPreviewAuditionStore').measuredPreviewAuditionStore;
let startMeasuredPreviewAudition: typeof import('../startMeasuredPreviewAudition').startMeasuredPreviewAudition;
let stopMeasuredPreviewAudition: typeof import('../stopMeasuredPreviewAudition').stopMeasuredPreviewAudition;
const wire = vi.hoisted(() => ({
    fence: 0,
    apply: vi.fn<(_: unknown) => Promise<unknown>>(),
    resolve: vi.fn<typeof import('../resolveMeasuredPreviewAudition').resolveMeasuredPreviewAudition>(),
}));
vi.mock('../resolveMeasuredPreviewAudition', () => ({ resolveMeasuredPreviewAudition: wire.resolve }));
const invokeNative: SourdawDesktopBridge['invoke'] = async (command, args) => {
    if (command === 'apply_graph_commands') {
        return wire.apply(args);
    }
    if (command === 'map_graph_batch') {
        return {};
    }
    if (command === 'engine_transport_position') {
        return { engineIncarnation: ID, running: true, playing: false, batchesApplied: wire.fence };
    }
    if (command === 'engine_transport_set_maps') {
        return {
            sampleRate: 48_000,
            tempoSegments: 1,
            timeSignatureSegments: 1,
            loopEnabled: false,
            admittedBatch: wire.fence,
        };
    }
    if (command === 'timeline_sample_lifecycle') {
        const request = args?.[0];
        if (typeof request === 'object' && request !== null && 'action' in request) {
            if (request.action === 'open') {
                return { owner: 'measured-audition-owner' };
            }
            if (request.action === 'prepare') {
                return { lease: 'measured-audition-lease', missing: [] };
            }
            if (request.action === 'release') {
                return { released: true };
            }
            if (request.action === 'retire') {
                return { complete: true, remainingReaders: 0, pendingFence: false };
            }
        }
    }
    throw new Error(`Unexpected native fixture command: ${command}`);
};

function parameter() {
    const gain = {
        value: 1,
        setValueAtTime: vi.fn((value: number) => {
            gain.value = value;
        }),
        cancelScheduledValues: vi.fn(),
    };
    return gain;
}
class Node {
    gain = parameter();
    connections: Node[] = [];
    buffer: AudioBuffer | null = null;
    onended: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    connect = vi.fn((node: Node) => {
        this.connections.push(node);
        return node;
    });
    disconnect = vi.fn(() => {
        this.connections.length = 0;
    });
}
async function engineFixture() {
    const analysers: Node[] = [];
    const sources: Node[] = [];
    const context = {
        currentTime: 0,
        sampleRate: 48_000,
        state: 'running',
        destination: new Node(),
        createGain: () => new Node(),
        createAnalyser: () => {
            const node = new Node();
            analysers.push(node);
            return node;
        },
        createChannelSplitter: () => new Node(),
        createBufferSource: () => {
            const node = new Node();
            sources.push(node);
            return node;
        },
        resume: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
    };
    vi.stubGlobal(
        'AudioContext',
        vi.fn(function () {
            return context;
        })
    );
    audio = await import('#/modules/AudioEngine/useCases');
    const engine = audio.audioEngine;
    expect(engine.context).toBe(context);
    const gate = analysers[0]?.connections[0];
    if (gate === undefined) {
        throw new Error('Missing actual programme gate.');
    }
    return { context, sources, gate, engine };
}
const ID = 'dc0f62d1-dc26-4c5c-81db-36130c1466e4:0';
const INPUT = { confirmationId: 'pending', targetId: 'drums', side: 'baseline' as const };
const applied = (admittedBatch: number) => ({
    acceptance: 'accepted' as const,
    application: 'applied' as const,
    runtimeRevision: 1,
    reports: [],
    engineIncarnation: ID,
    admittedBatch,
});
const pcm = new Float32Array([0.1, -0.2, 0.3, -0.4]);
const exact = {
    length: 4,
    sampleRate: 48_000,
    numberOfChannels: 1,
    duration: 4 / 48_000,
    getChannelData: () => pcm,
} as unknown as AudioBuffer;

async function installNativeSession() {
    Object.defineProperty(window, 'sourdaw', {
        configurable: true,
        value: { invoke: invokeNative } satisfies Pick<SourdawDesktopBridge, 'invoke'>,
    });
    wire.apply.mockImplementation(async () => applied(++wire.fence));
    const result = await audio.startNativeLiveGraphSession({
        positionSeconds: 0,
        transport: { kind: 'held', webAudioRollingSince: () => null },
        transportMaps: {
            tempo: [{ startSeconds: 0, beatsPerMinute: 120 }],
            timeSignature: [{ startSeconds: 0, numerator: 4, denominator: 4 }],
            loopRegion: { enabled: false, startSeconds: 0, endSeconds: 0 },
        },
        sampleRate: 48_000,
    });
    expect(result.outcome).toBe('started');
    expect(wire.apply).toHaveBeenCalledWith([
        expect.objectContaining({
            schemaVersion: 1,
            replaceTopology: true,
            timelineLease: 'measured-audition-lease',
            commands: expect.arrayContaining([
                { kind: 'set-monitor-shadow', shadowed: false },
                { kind: 'set-transport', playing: false, positionSeconds: 0 },
            ]),
        }),
    ]);
    wire.apply.mockClear();
}

const RESTORE_FAILURE = 'The native engine did not apply its audition output gate.';
/**
 * Each case resets modules and imports the real AudioEngine barrel again; the first does so cold,
 * which alone takes about nine seconds, so the default ten-second hook limit fails it under load.
 */
const COLD_ENGINE_IMPORT_TIMEOUT_MS = 60_000;

describe('measured audition controller through the actual exclusive source executor', () => {
    let driven: Awaited<ReturnType<typeof engineFixture>>;
    let bridgeDescriptor: PropertyDescriptor | undefined;
    beforeEach(async () => {
        bridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'sourdaw');
        Reflect.deleteProperty(window, 'sourdaw');
        vi.resetModules();
        wire.fence = 0;
        wire.apply.mockReset();
        wire.resolve.mockReset();
        driven = await engineFixture();
        ({ agentMeasurementArtifactStore } = await import('#/modules/AudioRendering/stores'));
        ({ measuredPreviewAuditionStore } = await import('../../stores/measuredPreviewAuditionStore'));
        ({ startMeasuredPreviewAudition } = await import('../startMeasuredPreviewAudition'));
        ({ stopMeasuredPreviewAudition } = await import('../stopMeasuredPreviewAudition'));
        wire.resolve.mockReturnValue({
            status: 'available',
            identity: 'pair-current',
            revision: 'revision',
            targetId: 'drums',
            baseline: { buffer: exact, gain: 0.5, lufs: -10 },
            preview: { buffer: exact, gain: 1, lufs: -16 },
            matchLufs: -16,
        });
    }, COLD_ENGINE_IMPORT_TIMEOUT_MS);
    afterEach(async () => {
        try {
            await stopMeasuredPreviewAudition();
            await audio.stopNativeLiveGraphSession({ positionSeconds: 0 });
            await driven.engine.dispose();
        } finally {
            if (bridgeDescriptor === undefined) {
                Reflect.deleteProperty(window, 'sourdaw');
            } else {
                Object.defineProperty(window, 'sourdaw', bridgeDescriptor);
            }
            vi.unstubAllGlobals();
        }
    });

    it('keeps explicit-stop/onEnded releasing until the actual native restore rejects', async () => {
        await installNativeSession();
        const restore = Promise.withResolvers<ReturnType<typeof applied>>();
        const apply = wire.apply.mockResolvedValueOnce(applied(++wire.fence)).mockReturnValueOnce(restore.promise);
        await expect(startMeasuredPreviewAudition(INPUT)).resolves.toEqual({ status: 'playing' });
        expect(driven.sources[0]?.buffer).toBe(exact);
        const stopped = stopMeasuredPreviewAudition();
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
        expect(measuredPreviewAuditionStore.value?.phase).toBe('releasing');
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(driven.gate.gain.value).toBe(0);
        restore.reject(new Error('actual restore rejected'));
        await expect(stopped).resolves.toEqual({ status: 'restore-failed', reason: RESTORE_FAILURE });
        expect(measuredPreviewAuditionStore.value?.phase).toBe('restore-failed');
        expect(driven.gate.gain.value).toBe(0);

        // While the native gate still refuses, each Stop retries the restore and fails on its own
        // attempt: a preview begun during it waits and fails with it, and none after it is held.
        const stillRefused = Promise.withResolvers<ReturnType<typeof applied>>();
        apply.mockReturnValueOnce(stillRefused.promise);
        const retried = stopMeasuredPreviewAudition();
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(3));
        const during = driven.engine.beginAudioPreviewIntent().ready;
        const duringFails = expect(during).rejects.toThrow(RESTORE_FAILURE);
        stillRefused.reject(new Error('actual restore still rejected'));
        await expect(retried).resolves.toEqual({ status: 'restore-failed', reason: RESTORE_FAILURE });
        await duringFails;
        expect(driven.gate.gain.value).toBe(0);
        expect(driven.engine.beginAudioPreviewIntent().ready).toBeUndefined();

        // The native gate applies again, so the next Stop restores the programme.
        await expect(stopMeasuredPreviewAudition()).resolves.toEqual({ status: 'stopped' });
        expect(apply).toHaveBeenCalledTimes(4);
        expect(apply.mock.calls[3]?.[0]).toEqual([
            expect.objectContaining({ commands: [{ kind: 'set-monitor-shadow', shadowed: false }] }),
        ]);
        expect(driven.gate.gain.value).toBe(1);
        expect(measuredPreviewAuditionStore.value?.phase).toBe('idle');
        const ordinary = audio.playAudioBufferPreview({ buffer: exact, onEnded: vi.fn() });
        await ordinary?.ready;
        expect(driven.sources.at(-1)?.start).toHaveBeenCalledOnce();
    });

    it('stops a playing audition when a project edit retires its pair', async () => {
        const { createCrdtDoc, mutateCrdtDoc } = await import('#/modules/CrdtDocument/useCases');
        await expect(startMeasuredPreviewAudition(INPUT)).resolves.toEqual({ status: 'playing' });
        expect(driven.gate.gain.value).toBe(0);
        createCrdtDoc('root');
        wire.resolve.mockReturnValue({ status: 'unavailable', reason: 'The project changed after measurement.' });
        mutateCrdtDoc<{ tempo?: number }>({
            id: 'root',
            changeFn: (doc) => {
                doc.tempo = 128;
            },
        });
        expect(driven.sources[0]?.stop).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(measuredPreviewAuditionStore.value?.phase).toBe('idle'));
        expect(driven.gate.gain.value).toBe(1);
        await expect(startMeasuredPreviewAudition(INPUT)).resolves.toEqual({
            status: 'unavailable',
            reason: 'The project changed after measurement.',
        });
        expect(driven.sources).toHaveLength(1);
    });

    it('canonical invalidation while acquiring the source handle waits its real restoration', async () => {
        await installNativeSession();
        const restore = Promise.withResolvers<ReturnType<typeof applied>>();
        const apply = wire.apply.mockReturnValueOnce(restore.promise);
        const pair = wire.resolve(INPUT);
        let valid = true;
        wire.resolve.mockImplementation(() => {
            if (valid) {
                return pair;
            }
            return { status: 'unavailable', reason: 'retained pair retired' };
        });
        const begin = driven.engine.beginExclusiveAudioPreviewIntent.bind(driven.engine);
        const acquiring = vi.spyOn(driven.engine, 'beginExclusiveAudioPreviewIntent').mockImplementationOnce(() => {
            const intent = begin();
            valid = false;
            agentMeasurementArtifactStore.set({ artifacts: [] });
            return intent;
        });
        const started = startMeasuredPreviewAudition(INPUT);
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
        expect(measuredPreviewAuditionStore.value?.phase).toBe('releasing');
        expect(driven.sources).toHaveLength(0);
        restore.reject(new Error('handle-acquisition restoration rejected'));
        await expect(started).resolves.toEqual({ status: 'superseded' });
        expect(measuredPreviewAuditionStore.value?.phase).toBe('restore-failed');
        acquiring.mockRestore();
    });

    it('an old delayed resume cannot publish or start over the newer side', async () => {
        const resumed = Promise.withResolvers<void>();
        driven.context.resume.mockReturnValueOnce(resumed.promise);
        const first = startMeasuredPreviewAudition(INPUT);
        expect(measuredPreviewAuditionStore.value?.phase).toBe('acquiring');
        const second = startMeasuredPreviewAudition({ ...INPUT, side: 'preview' });
        await expect(second).resolves.toEqual({ status: 'playing' });
        const operation = measuredPreviewAuditionStore.value?.operationId;
        resumed.resolve();
        await expect(first).resolves.toEqual({ status: 'superseded' });
        expect(driven.sources).toHaveLength(1);
        expect(driven.sources[0]?.start).toHaveBeenCalledTimes(1);
        expect(measuredPreviewAuditionStore.value).toMatchObject({
            phase: 'playing',
            side: 'preview',
            operationId: operation,
        });
    });

    it('a retired operation cannot overwrite its playing successor when its restore fails', async () => {
        await installNativeSession();
        const restore = Promise.withResolvers<ReturnType<typeof applied>>();
        const apply = wire.apply.mockResolvedValueOnce(applied(++wire.fence)).mockReturnValueOnce(restore.promise);
        await startMeasuredPreviewAudition(INPUT);
        const old = stopMeasuredPreviewAudition();
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
        const next = startMeasuredPreviewAudition({ ...INPUT, side: 'preview' });
        const successor = measuredPreviewAuditionStore.value?.operationId;
        restore.reject(new Error('old restore rejected'));
        await expect(old).resolves.toMatchObject({ status: 'restore-failed' });
        await expect(next).resolves.toEqual({ status: 'playing' });
        expect(measuredPreviewAuditionStore.value).toMatchObject({
            operationId: successor,
            phase: 'playing',
            side: 'preview',
            error: null,
        });
    });
});
