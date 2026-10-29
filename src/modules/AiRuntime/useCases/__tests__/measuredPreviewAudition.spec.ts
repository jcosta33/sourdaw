import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentMeasurementArtifactStore } from '#/modules/AudioRendering/stores';

import { type AudioEngine } from '#/modules/AudioEngine/models/AudioEngineState';
import { type AudioGraphBackend } from '#/modules/AudioEngine/models/AudioGraphBackend';
import { stoppedEngineTransportPosition } from '#/modules/AudioEngine/models/EngineTransportPosition';
import { createAudioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { getEngineTransportPosition } from '#/modules/AudioEngine/repositories/engineTransport/getEngineTransportPosition';
import { nativeLiveGraphSession } from '#/modules/AudioEngine/useCases/livePlayback/nativeLiveGraphSessionState';
import { nativeLiveGraphSessionOffered } from '#/modules/AudioEngine/useCases/livePlayback/nativeLiveGraphSessionOffered';

import { measuredPreviewAuditionRuntime } from '../../services/measuredPreviewAuditionRuntime';
import { measuredPreviewAuditionStore } from '../../stores/measuredPreviewAuditionStore';
import { resolveMeasuredPreviewAudition } from '../resolveMeasuredPreviewAudition';
import { startMeasuredPreviewAudition } from '../startMeasuredPreviewAudition';
import { stopMeasuredPreviewAudition } from '../stopMeasuredPreviewAudition';

const fixture = vi.hoisted(() => ({ engine: null as AudioEngine | null }));
vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/repositories/createWebAudioEngine')>()),
    get audioEngine() {
        if (fixture.engine === null) throw new Error('The actual controller fixture engine is missing.');
        return fixture.engine;
    },
}));
// These cases own controller/executor lifetime, not proof admission. Genuine
// receipt production and inverse resolver admission run in previewMeasurement.spec.ts.
vi.mock('../resolveMeasuredPreviewAudition', () => ({ resolveMeasuredPreviewAudition: vi.fn() }));
vi.mock('#/modules/AudioEngine/repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/livePlayback/nativeLiveGraphSessionOffered', () => ({
    nativeLiveGraphSessionOffered: vi.fn(() => false),
}));
vi.mock('#/modules/AudioEngine/useCases/livePlayback/reportAttachedPlugins', () => ({
    reportAttachedPlugins: vi.fn(),
}));

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
function engineFixture() {
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
    const engine = createAudioEngine(context as unknown as AudioContext);
    fixture.engine = engine;
    const gate = analysers[0]?.connections[0];
    if (gate === undefined) throw new Error('Missing actual programme gate.');
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

describe('measured audition controller through the actual exclusive source executor', () => {
    let driven: ReturnType<typeof engineFixture>;
    beforeEach(() => {
        driven = engineFixture();
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(false);
        vi.mocked(getEngineTransportPosition).mockReset();
        Object.assign(nativeLiveGraphSession, {
            backend: null,
            orphanedBackend: null,
            startsPending: 0,
            programmeCarrier: false,
            audibleCarrier: false,
            monitorShadowed: false,
            auditionOwner: null,
            auditionRestorationOwner: null,
            auditionOutputSuppressed: false,
            auditionEpoch: 0,
            auditionInvalidation: null,
            pending: Promise.resolve(),
        });
        measuredPreviewAuditionRuntime.current = null;
        measuredPreviewAuditionRuntime.operations.clear();
        measuredPreviewAuditionStore.set({
            confirmationId: null,
            operationId: null,
            targetId: null,
            side: null,
            phase: 'idle',
            error: null,
        });
        vi.mocked(resolveMeasuredPreviewAudition).mockReturnValue({
            status: 'available',
            identity: 'pair-current',
            revision: 'revision',
            targetId: 'drums',
            baseline: { buffer: exact, gain: 0.5, lufs: -10 },
            preview: { buffer: exact, gain: 1, lufs: -16 },
            matchLufs: -16,
        });
    });
    afterEach(async () => {
        await stopMeasuredPreviewAudition();
        await driven.engine.dispose();
        await nativeLiveGraphSession.pending;
        fixture.engine = null;
    });

    it('keeps explicit-stop/onEnded releasing until the actual native restore rejects', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const restore = Promise.withResolvers<ReturnType<typeof applied>>();
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockResolvedValueOnce(applied(1))
            .mockReturnValueOnce(restore.promise);
        nativeLiveGraphSession.backend = { backendId: 'native/live', apply, dispose: vi.fn() };
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: 1,
        });
        await expect(startMeasuredPreviewAudition(INPUT)).resolves.toEqual({ status: 'playing' });
        expect(driven.sources[0]?.buffer).toBe(exact);
        const stopped = stopMeasuredPreviewAudition();
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
        expect(measuredPreviewAuditionStore.value?.phase).toBe('releasing');
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(driven.gate.gain.value).toBe(0);
        restore.reject(new Error('actual restore rejected'));
        await expect(stopped).resolves.toEqual({ status: 'restore-failed', reason: 'actual restore rejected' });
        expect(measuredPreviewAuditionStore.value?.phase).toBe('restore-failed');
        expect(driven.gate.gain.value).toBe(0);
    });

    it('canonical invalidation while acquiring the source handle waits its real restoration', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const restore = Promise.withResolvers<ReturnType<typeof applied>>();
        const apply = vi.fn<AudioGraphBackend['apply']>().mockReturnValue(restore.promise);
        nativeLiveGraphSession.backend = { backendId: 'native/live', apply, dispose: vi.fn() };
        const pair = resolveMeasuredPreviewAudition(INPUT);
        let valid = true;
        vi.mocked(resolveMeasuredPreviewAudition).mockImplementation(() =>
            valid ? pair : { status: 'unavailable', reason: 'retained pair retired' }
        );
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
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const restore = Promise.withResolvers<ReturnType<typeof applied>>();
        let fence = 1;
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockImplementation(async () => applied(++fence))
            .mockResolvedValueOnce(applied(1))
            .mockReturnValueOnce(restore.promise);
        nativeLiveGraphSession.backend = { backendId: 'native/live', apply, dispose: vi.fn() };
        vi.mocked(getEngineTransportPosition).mockImplementation(async () => ({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: fence,
        }));
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
