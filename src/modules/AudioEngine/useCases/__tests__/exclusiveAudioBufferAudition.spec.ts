import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioEngine } from '../../models/AudioEngineState';
import { type AudioGraphApplyResult, type AudioGraphBackend } from '../../models/AudioGraphBackend';
import { stoppedEngineTransportPosition } from '../../models/EngineTransportPosition';
import { createAudioEngine } from '../../repositories/createWebAudioEngine';
import { getEngineTransportPosition } from '../../repositories/engineTransport/getEngineTransportPosition';
import { nativeLiveGraphSessionOffered } from '../livePlayback/nativeLiveGraphSessionOffered';
import { nativeLiveGraphSession } from '../livePlayback/nativeLiveGraphSessionState';
import { startNativeLiveGraphSession } from '../livePlayback/startNativeLiveGraphSession';
import { playAudioBufferPreview } from '../playAudioBufferPreview';
import { playExclusiveAudioBufferPreview } from '../playExclusiveAudioBufferPreview';

const fixture = vi.hoisted(() => {
    const current: { engine: AudioEngine | null; startBackend: AudioGraphBackend | null } = {
        engine: null,
        startBackend: null,
    };
    return current;
});
vi.mock('../../repositories/createWebAudioEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../repositories/createWebAudioEngine')>();
    return {
        ...actual,
        get audioEngine() {
            if (fixture.engine === null) {
                throw new Error('The real fixture engine is not installed.');
            }
            return fixture.engine;
        },
    };
});
vi.mock('../../repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: vi.fn(),
}));
vi.mock('../livePlayback/nativeLiveGraphSessionOffered', () => ({ nativeLiveGraphSessionOffered: vi.fn(() => false) }));
vi.mock('../livePlayback/reportAttachedPlugins', () => ({ reportAttachedPlugins: vi.fn() }));

// Only native I/O/projection dependencies are doubled here. The actual native
// start operation, queue, installation and audition invalidation all execute.
vi.mock('../../repositories/nativeGraph/probeNativeGraphTransport', () => ({
    probeNativeGraphTransport: async () => ({ available: true, transport: {} }),
}));
vi.mock('../../repositories/nativeGraph/createNativeLiveGraphBackend', () => ({
    createNativeLiveGraphBackend: () => {
        if (fixture.startBackend === null) {
            throw new Error('Missing start transport fixture.');
        }
        return fixture.startBackend;
    },
}));
vi.mock('../../repositories/engineTransport/setEngineTransportMaps', () => ({
    setEngineTransportMaps: async () => ({
        outcome: 'applied',
        applied: {
            sampleRate: 48_000,
            tempoSegments: 1,
            timeSignatureSegments: 1,
            loopEnabled: false,
            admittedBatch: 1,
        },
    }),
}));
vi.mock('../livePlayback/projectLiveGraphTopology', () => ({
    projectLiveGraphTopology: () => [
        { kind: 'set-monitor-shadow', shadowed: false },
        { kind: 'set-transport', playing: false, positionSeconds: 0 },
    ],
}));
vi.mock('../livePlayback/readSessionProgramme', () => ({
    readSessionProgramme: () => ({
        playbacksByStripId: new Map(),
        exclusions: [],
        bakedStripIds: new Set(),
        webVoicedStripIds: new Set(),
    }),
}));
vi.mock('../livePlayback/claimCarriedStrips', () => ({ claimCarriedStrips: vi.fn() }));
vi.mock('../livePlayback/armNativeLiveAutomationWriter', () => ({ armNativeLiveAutomationWriter: vi.fn() }));
vi.mock('../livePlayback/armNativeLiveMidiWriter', () => ({ armNativeLiveMidiWriter: vi.fn() }));
vi.mock('../livePlayback/startNativeEnginePlayheadFeed', () => ({ startNativeEnginePlayheadFeed: vi.fn() }));
vi.mock('../livePlayback/watchNativeEngineLiveness', () => ({ startNativeEngineLivenessWatch: vi.fn() }));

const START = {
    positionSeconds: 0,
    sampleRate: 48_000,
    transportMaps: {
        tempo: [{ startSeconds: 0, beatsPerMinute: 120 }],
        timeSignature: [{ startSeconds: 0, numerator: 4, denominator: 4 }],
        loopRegion: { enabled: false, startSeconds: 0, endSeconds: 0 },
    },
    transport: { kind: 'held' as const, webAudioRollingSince: () => null },
};

function parameter(value = 1) {
    const result = {
        value,
        setValueAtTime: vi.fn((next: number) => {
            result.value = next;
        }),
        setTargetAtTime: vi.fn((next: number) => {
            result.value = next;
        }),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
    return result;
}

class ControlNode {
    readonly gain = parameter();
    readonly frequency = parameter(440);
    readonly connections: ControlNode[] = [];
    fftSize = 256;
    smoothingTimeConstant = 0.8;
    channelCount = 2;
    channelCountMode = 'max';
    channelInterpretation = 'speakers';
    numberOfInputs = 1;
    buffer: AudioBuffer | null = null;
    onended: (() => void) | null = null;
    type = 'sine';
    readonly start = vi.fn();
    readonly stop = vi.fn();
    readonly addEventListener = vi.fn();
    readonly connect = vi.fn((target: ControlNode) => {
        this.connections.push(target);
        return target;
    });
    readonly disconnect = vi.fn(() => {
        this.connections.length = 0;
    });
}

/** A control-call model, not a device or a claimed acoustic renderer. The engine itself is real. */
function contextFixture() {
    const sources: ControlNode[] = [];
    const analysers: ControlNode[] = [];
    const context = {
        destination: new ControlNode(),
        sampleRate: 48_000,
        currentTime: 0,
        state: 'running',
        baseLatency: 0,
        outputLatency: 0,
        createGain: () => new ControlNode(),
        createAnalyser: () => {
            const node = new ControlNode();
            analysers.push(node);
            return node;
        },
        createChannelSplitter: () => new ControlNode(),
        createBufferSource: () => {
            const source = new ControlNode();
            sources.push(source);
            return source;
        },
        createOscillator: () => new ControlNode(),
        resume: vi.fn(async () => {}),
        suspend: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    // Same structural context boundary as the existing listening-path model;
    // no hardware readiness is supplied by this cast or asserted by these tests.
    const engine = createAudioEngine(context as unknown as AudioContext);
    fixture.engine = engine;
    const gate = analysers[0]?.connections[0];
    if (gate === undefined) {
        throw new Error('The real constructor must wire its programme gate.');
    }
    return { context, engine, sources, gate };
}

function buffer(): AudioBuffer {
    const pcm = new Float32Array([0.125, -0.25, 0.375, -0.5]);
    return {
        length: pcm.length,
        sampleRate: 48_000,
        numberOfChannels: 1,
        duration: pcm.length / 48_000,
        getChannelData: () => pcm,
    } as unknown as AudioBuffer;
}

const ID = 'dc0f62d1-dc26-4c5c-81db-36130c1466e4:0';
function applied(fence: number): AudioGraphApplyResult {
    return {
        acceptance: 'accepted',
        application: 'applied',
        runtimeRevision: fence,
        admittedBatch: fence,
        engineIncarnation: ID,
        reports: [],
    };
}

describe('exclusive retained buffer listening lifetime', () => {
    let driven: ReturnType<typeof contextFixture>;
    beforeEach(() => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(false);
        vi.mocked(getEngineTransportPosition).mockReset();
        Object.assign(nativeLiveGraphSession, {
            backend: null,
            orphanedBackend: null,
            startsPending: 0,
            programmeCarrier: false,
            audibleCarrier: false,
            monitorShadowed: true,
            auditionOwner: null,
            auditionRestorationOwner: null,
            auditionOutputSuppressed: false,
            auditionEpoch: 0,
            auditionInvalidation: null,
            pending: Promise.resolve(),
        });
        fixture.startBackend = null;
        driven = contextFixture();
    });
    afterEach(async () => {
        await driven.engine.dispose();
        await nativeLiveGraphSession.pending;
        fixture.engine = null;
    });

    it('sets the real programme gate0 before suspended-context resume and starts only after resume settles', async () => {
        const resume = Promise.withResolvers<void>();
        driven.context.state = 'suspended';
        driven.context.resume.mockImplementation(() => {
            expect(driven.gate.gain.value).toBe(0);
            return resume.promise;
        });
        const exact = buffer();
        const playback = playExclusiveAudioBufferPreview({
            buffer: exact,
            gain: 0.5,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        expect(driven.context.resume).toHaveBeenCalledTimes(1);
        expect(driven.sources).toHaveLength(0);
        resume.resolve();
        await playback.ready;
        expect(driven.sources).toHaveLength(1);
        expect(driven.sources[0]?.buffer).toBe(exact);
        expect(driven.sources[0]?.start).toHaveBeenCalledTimes(1);
        await playback.stop();
        expect(driven.gate.gain.value).toBe(1);
    });

    it('a newer ordinary gesture stops the retained side and waits actual programme restoration', async () => {
        const exclusive = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        await exclusive.ready;
        const intent = driven.engine.beginAudioPreviewIntent();
        expect(intent.ready).toBeDefined();
        const ordinary = playAudioBufferPreview({ buffer: buffer(), intent, onEnded: vi.fn() });
        if (ordinary === null) {
            throw new Error('The new ordinary gesture must own its source.');
        }
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(driven.sources[1]?.start).not.toHaveBeenCalled();
        await ordinary.ready;
        expect(driven.sources[1]?.start).toHaveBeenCalledTimes(1);
        expect(driven.gate.gain.value).toBe(1);
        ordinary.stop();
    });

    it('ordinary buffers remain polyphonic until an exclusive gesture owns the output', async () => {
        const one = playAudioBufferPreview({ buffer: buffer(), onEnded: vi.fn() });
        const two = playAudioBufferPreview({ buffer: buffer(), onEnded: vi.fn() });
        expect(one).not.toBeNull();
        expect(two).not.toBeNull();
        expect(driven.sources.map((source) => source.start.mock.calls.length)).toEqual([1, 1]);
        expect(driven.sources.map((source) => source.stop.mock.calls.length)).toEqual([0, 0]);
        const exclusive = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        await exclusive.ready;
        expect(driven.sources.slice(0, 2).map((source) => source.stop.mock.calls.length)).toEqual([1, 1]);
        await exclusive.stop();
    });

    it('publishes one real restoration latch before explicit-stop and ended callbacks can reenter', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const restore = Promise.withResolvers<AudioGraphApplyResult>();
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockResolvedValueOnce(applied(1))
            .mockReturnValueOnce(restore.promise);
        Object.assign(nativeLiveGraphSession, {
            backend: { backendId: 'native/live', apply, dispose: vi.fn() },
            programmeCarrier: true,
            audibleCarrier: true,
            monitorShadowed: false,
        });
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: 1,
        });
        let reentrant: Promise<void> | null = null;
        const playback = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: () => {
                reentrant = playback.stop();
            },
        });
        await playback.ready;
        const stopping = playback.stop();
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
        expect(reentrant).toBe(stopping);
        expect(driven.gate.gain.value).toBe(0);
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        restore.reject(new Error('native restoration rejected'));
        await expect(stopping).rejects.toThrow('native restoration rejected');
        expect(driven.gate.gain.value).toBe(0);
    });
    it('an older deferred native start installs without cancelling the newer A/B owner', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const topology = Promise.withResolvers<AudioGraphApplyResult>();
        let fence = 1;
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockImplementation(async () => applied(++fence))
            .mockReturnValueOnce(topology.promise);
        fixture.startBackend = { backendId: 'native/live', apply, dispose: vi.fn() };
        vi.mocked(getEngineTransportPosition).mockImplementation(async () => ({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: fence,
        }));
        const start = startNativeLiveGraphSession(START);
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
        const playback = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        expect(driven.gate.gain.value).toBe(0);
        topology.resolve(applied(1));
        await expect(start).resolves.toMatchObject({ outcome: 'started' });
        await playback.ready;
        expect(driven.sources[0]?.start).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenLastCalledWith({
            schemaVersion: 1,
            commands: [{ kind: 'set-monitor-shadow', shadowed: true }],
        });
        await playback.stop();
        expect(driven.gate.gain.value).toBe(1);
    });

    it('a newer native start cancels an A/B still acquiring before that start reaches its queue', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const gate = Promise.withResolvers<AudioGraphApplyResult>();
        let fence = 1;
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockImplementation(async () => applied(++fence))
            .mockReturnValueOnce(gate.promise);
        fixture.startBackend = { backendId: 'native/live', apply, dispose: vi.fn() };
        nativeLiveGraphSession.backend = fixture.startBackend;
        vi.mocked(getEngineTransportPosition).mockImplementation(async () => ({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: fence,
        }));
        const playback = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        const refused = expect(playback.ready).rejects.toThrow('stopped before listening readiness');
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
        const start = startNativeLiveGraphSession(START);
        expect(nativeLiveGraphSession.auditionOwner).toBeNull();
        expect(driven.sources).toHaveLength(0);
        gate.resolve(applied(1));
        await refused;
        await expect(start).resolves.toMatchObject({ outcome: 'started' });
        await playback.stop().catch(() => undefined);
    });

    it('a newer native start cancels a playing A/B synchronously at admission', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        let fence = 0;
        const apply = vi.fn<AudioGraphBackend['apply']>().mockImplementation(async () => applied(++fence));
        fixture.startBackend = { backendId: 'native/live', apply, dispose: vi.fn() };
        nativeLiveGraphSession.backend = fixture.startBackend;
        vi.mocked(getEngineTransportPosition).mockImplementation(async () => ({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: fence,
        }));
        const playback = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        await playback.ready;
        const start = startNativeLiveGraphSession(START);
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.auditionOwner).toBeNull();
        await expect(start).resolves.toMatchObject({ outcome: 'started' });
        await playback.stop().catch(() => undefined);
    });

    it('restores Web programme after a newer native start supersedes the releasing native fence', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        let fence = 0;
        const apply = vi.fn<AudioGraphBackend['apply']>().mockImplementation(async () => applied(++fence));
        fixture.startBackend = { backendId: 'native/live', apply, dispose: vi.fn() };
        nativeLiveGraphSession.backend = fixture.startBackend;
        const position = Promise.withResolvers<Awaited<ReturnType<typeof getEngineTransportPosition>>>();
        vi.mocked(getEngineTransportPosition)
            .mockImplementation(async () => ({
                ...stoppedEngineTransportPosition,
                running: true,
                engineIncarnation: ID,
                batchesApplied: fence,
            }))
            .mockResolvedValueOnce({
                ...stoppedEngineTransportPosition,
                running: true,
                engineIncarnation: ID,
                batchesApplied: 1,
            })
            .mockReturnValueOnce(position.promise);
        const playback = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        await playback.ready;
        const release = playback.stop();
        void release.catch(() => undefined);
        await vi.waitFor(() => expect(getEngineTransportPosition).toHaveBeenCalledTimes(2));
        const start = startNativeLiveGraphSession(START);
        position.resolve({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: 2,
        });
        await expect(start).resolves.toMatchObject({ outcome: 'started' });
        await release.catch(() => undefined);
        expect(driven.gate.gain.value).toBe(1);
    });

    it('a delayed old release cannot open over a successor acquisition followed by its own failed Stop', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        let fence = 0;
        const firstPosition = Promise.withResolvers<Awaited<ReturnType<typeof getEngineTransportPosition>>>();
        const secondApply = Promise.withResolvers<AudioGraphApplyResult>();
        const secondRestore = Promise.withResolvers<AudioGraphApplyResult>();
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockImplementation(async () => applied(++fence))
            .mockResolvedValueOnce(applied(1))
            .mockResolvedValueOnce(applied(2))
            .mockReturnValueOnce(secondApply.promise)
            .mockReturnValueOnce(secondRestore.promise);
        nativeLiveGraphSession.backend = { backendId: 'native/live', apply, dispose: vi.fn() };
        vi.mocked(getEngineTransportPosition)
            .mockResolvedValueOnce({
                ...stoppedEngineTransportPosition,
                running: true,
                engineIncarnation: ID,
                batchesApplied: 1,
            })
            .mockReturnValueOnce(firstPosition.promise);
        const first = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        await first.ready;
        const oldRelease = first.stop();
        void oldRelease.catch(() => undefined);
        await vi.waitFor(() => expect(getEngineTransportPosition).toHaveBeenCalledTimes(2));
        const second = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        const notReady = expect(second.ready).rejects.toThrow('stopped before listening readiness');
        // The old position completes after A2 owns the output. It cannot open it.
        firstPosition.resolve({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: 2,
        });
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(3));
        const latestRelease = second.stop();
        void latestRelease.catch(() => undefined);
        secondApply.resolve(applied(3));
        await notReady;
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(4));
        secondRestore.reject(new Error('latest restoration rejected'));
        await expect(latestRelease).rejects.toThrow('latest restoration rejected');
        await expect(oldRelease).rejects.toThrow('request changed');
        expect(driven.gate.gain.value).toBe(0);
        expect(driven.sources).toHaveLength(1);
    });
});
