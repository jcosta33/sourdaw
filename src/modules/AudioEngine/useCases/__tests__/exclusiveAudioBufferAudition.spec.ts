import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { type AudioEngine } from '../../models/AudioEngineState';
import { type AudioGraphApplyResult, type AudioGraphBackend } from '../../models/AudioGraphBackend';
import { stoppedEngineTransportPosition } from '../../models/EngineTransportPosition';
import { createAudioEngine } from '../../repositories/createWebAudioEngine';
import { getEngineTransportPosition } from '../../repositories/engineTransport/getEngineTransportPosition';
import { type createNativeLiveGraphBackend } from '../../repositories/nativeGraph/createNativeLiveGraphBackend';
import { abandonNativeLiveGraphSession } from '../livePlayback/abandonNativeLiveGraphSession';
import { nativeLiveGraphSessionOffered } from '../livePlayback/nativeLiveGraphSessionOffered';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from '../livePlayback/nativeLiveGraphSessionState';
import { startNativeLiveGraphSession } from '../livePlayback/startNativeLiveGraphSession';
import { playAudioBufferPreview } from '../playAudioBufferPreview';
import { playExclusiveAudioBufferPreview } from '../playExclusiveAudioBufferPreview';

const fixture = vi.hoisted(() => {
    const current: { engine: AudioEngine | null; startBackend: NativeStartBackend | null } = {
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
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

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

/** The programme gate is its one edge into the listening output, never its gain. */
function programmeOpen(gate: ControlNode): boolean {
    return gate.connections.length > 0;
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

type NativeStartBackend = AudioGraphBackend &
    Pick<ReturnType<typeof createNativeLiveGraphBackend>, 'rollAtFinalAdmission'>;

/** A start's backend: its final-admission roll reaches `apply` as the one set-transport batch the real backend sends. */
function nativeStartBackend(apply: AudioGraphBackend['apply']): NativeStartBackend {
    return {
        backendId: 'native/live',
        apply,
        dispose: vi.fn(),
        rollAtFinalAdmission: (_positionSeconds, finalize) =>
            apply({ schemaVersion: 1, commands: [{ kind: 'set-transport', playing: true, ...finalize() }] }),
    };
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

    it('closes the real programme gate before suspended-context resume and starts only after resume settles', async () => {
        const resume = Promise.withResolvers<void>();
        driven.context.state = 'suspended';
        driven.context.resume.mockImplementation(() => {
            expect(programmeOpen(driven.gate)).toBe(false);
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
        expect(programmeOpen(driven.gate)).toBe(true);
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
        expect(programmeOpen(driven.gate)).toBe(true);
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
        expect(programmeOpen(driven.gate)).toBe(false);
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        restore.reject(new Error('native restoration rejected'));
        await expect(stopping).rejects.toThrow('native restoration rejected');
        expect(programmeOpen(driven.gate)).toBe(false);
    });
    it('reopens the Web programme when an abandon leaves a playing audition no native programme', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        let fence = 0;
        const apply = vi.fn<AudioGraphBackend['apply']>().mockImplementation(async () => applied(++fence));
        Object.assign(nativeLiveGraphSession, {
            backend: { backendId: 'native/live', apply, dispose: vi.fn() },
            programmeCarrier: true,
            audibleCarrier: true,
            monitorShadowed: false,
        });
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
        expect(programmeOpen(driven.gate)).toBe(false);
        abandonNativeLiveGraphSession('stalled');
        expect(nativeLiveGraphSession.orphanedBackend).not.toBeNull();
        // The abandon itself retires the audition: no Stop is needed to reopen the programme.
        await vi.waitFor(() => expect(programmeOpen(driven.gate)).toBe(true));
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        await playback.stop();
        expect(programmeOpen(driven.gate)).toBe(true);
        // The stalled engine is not addressed again: there is no native programme to restore into.
        expect(apply).toHaveBeenCalledTimes(1);
        const ordinary = playAudioBufferPreview({
            buffer: buffer(),
            intent: driven.engine.beginAudioPreviewIntent(),
            onEnded: vi.fn(),
        });
        await ordinary?.ready;
        expect(driven.sources.at(-1)?.start).toHaveBeenCalledOnce();
    });

    function readinessTimeouts(warn: { mock: { calls: unknown[][] } }) {
        return warn.mock.calls.filter(
            ([error]) =>
                error instanceof Error &&
                error.cause instanceof Error &&
                error.cause.message === 'Native audition listening readiness timed out.'
        );
    }

    it('recovers an engine-started release queued behind a slow native start', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        let fence = 0;
        const apply = vi.fn<AudioGraphBackend['apply']>().mockImplementation(async (batch) => {
            const result = applied(++fence);
            // Only the start's topology batch is slow: longer than the release's readiness window.
            if (batch.commands.some((command) => command.kind === 'set-transport' && !command.playing)) {
                await new Promise((resolve) => setTimeout(resolve, 3_500));
            }
            return result;
        });
        fixture.startBackend = nativeStartBackend(apply);
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
        expect(programmeOpen(driven.gate)).toBe(false);
        const start = startNativeLiveGraphSession(START);
        expect(driven.sources[0]?.stop).toHaveBeenCalledTimes(1);
        await expect(start).resolves.toMatchObject({ outcome: 'started' });
        await vi.waitFor(() => expect(programmeOpen(driven.gate)).toBe(true));
        // The queue wait behind the start spends none of the release's window.
        expect(readinessTimeouts(warn)).toHaveLength(0);
        warn.mockRestore();
    }, 10_000);

    it('reopens the programme after two overlapping slow starts without timing out', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        let fence = 0;
        const apply = vi.fn<AudioGraphBackend['apply']>().mockImplementation(async (batch) => {
            const result = applied(++fence);
            if (batch.commands.some((command) => command.kind === 'set-transport' && !command.playing)) {
                await new Promise((resolve) => setTimeout(resolve, 3_500));
            }
            return result;
        });
        fixture.startBackend = nativeStartBackend(apply);
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
        expect(programmeOpen(driven.gate)).toBe(false);
        const first = startNativeLiveGraphSession(START);
        await new Promise((resolve) => setTimeout(resolve, 3_200));
        const second = startNativeLiveGraphSession(START);
        await expect(first).resolves.toMatchObject({ outcome: 'started' });
        await expect(second).resolves.toMatchObject({ outcome: 'started' });
        await vi.waitFor(() => expect(programmeOpen(driven.gate)).toBe(true));
        expect(readinessTimeouts(warn)).toHaveLength(0);
        warn.mockRestore();
    }, 15_000);

    function refusingSession(refusals: number) {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        let fence = 0;
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockImplementation(async () => applied(++fence))
            .mockImplementationOnce(async () => applied(++fence));
        for (let refusal = 0; refusal < refusals; refusal += 1) {
            apply.mockRejectedValueOnce(new Error('native output gate refused'));
        }
        Object.assign(nativeLiveGraphSession, {
            backend: { backendId: 'native/live', apply, dispose: vi.fn() },
            programmeCarrier: true,
            audibleCarrier: true,
            monitorShadowed: false,
        });
        vi.mocked(getEngineTransportPosition).mockImplementation(async () => ({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: fence,
        }));
        return apply;
    }

    function audition() {
        return playExclusiveAudioBufferPreview({ buffer: buffer(), gain: 1, isCurrent: () => true, onEnded: vi.fn() });
    }

    /** Let every queued command and timer-free continuation run, with no new session command. */
    async function idle() {
        await nativeLiveGraphSession.pending;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const sessionCommand = () => queueOnNativeLiveGraphSession(async () => undefined);

    it.each([1, 2])(
        'reopens after %i gate refusals only as session commands settle, never while the session is idle',
        async (refusals) => {
            const apply = refusingSession(refusals);
            const playback = audition();
            await playback.ready;
            // An unmounting card's one Stop: nobody remains to press another.
            await expect(playback.stop()).rejects.toThrow('native output gate refused');
            for (let attempt = 1; attempt <= refusals; attempt += 1) {
                await idle();
                expect(apply).toHaveBeenCalledTimes(1 + attempt);
                expect(programmeOpen(driven.gate)).toBe(false);
                await sessionCommand();
                await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2 + attempt));
            }
            await vi.waitFor(() => expect(programmeOpen(driven.gate)).toBe(true));
            await sessionCommand();
            await idle();
            expect(apply).toHaveBeenCalledTimes(2 + refusals);
        }
    );

    it('stops recovering once a newer audition owns the output', async () => {
        const apply = refusingSession(1);
        const first = audition();
        await first.ready;
        await expect(first.stop()).rejects.toThrow('native output gate refused');
        const second = audition();
        const successor = nativeLiveGraphSession.auditionOwner;
        await second.ready;
        await sessionCommand();
        await idle();
        expect(apply).toHaveBeenCalledTimes(3);
        expect(successor).not.toBeNull();
        expect(nativeLiveGraphSession.auditionOwner).toBe(successor);
        expect(programmeOpen(driven.gate)).toBe(false);
        expect(driven.sources[1]?.stop).not.toHaveBeenCalled();
        await second.stop();
        expect(programmeOpen(driven.gate)).toBe(true);
    });

    it('stops recovering once the output context is unsafe', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const apply = refusingSession(1);
        const first = audition();
        await first.ready;
        await expect(first.stop()).rejects.toThrow('native output gate refused');
        const second = audition();
        await second.ready;
        driven.sources[1]?.stop.mockImplementation(() => {
            throw new Error('source stop failed');
        });
        await expect(second.stop()).rejects.toThrow('source stop failed');
        await sessionCommand();
        await idle();
        await sessionCommand();
        await idle();
        const unsafeRefusals = warn.mock.calls.filter(
            ([error]) =>
                error instanceof Error &&
                error.cause instanceof Error &&
                error.cause.message === 'Audition source cleanup failed. Reload to restore listening.'
        );
        expect(unsafeRefusals).toHaveLength(1);
        expect(apply).toHaveBeenCalledTimes(3);
        expect(programmeOpen(driven.gate)).toBe(false);
        warn.mockRestore();
    });

    /** A declined desktop start left its engine booted in the slot with no session backend. */
    function bootedWithoutBackend() {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ID,
            batchesApplied: 1,
        });
    }

    it('reopens the programme when an audition fails beside an unowned booted engine', async () => {
        bootedWithoutBackend();
        const playback = audition();
        await expect(playback.ready).rejects.toThrow('did not witness an empty output slot');
        expect(driven.sources).toHaveLength(0);
        await vi.waitFor(() => expect(programmeOpen(driven.gate)).toBe(true));
        // Only the acquisition read the engine: the release touches nothing native.
        expect(getEngineTransportPosition).toHaveBeenCalledOnce();
        await sessionCommand();
        await idle();
        expect(getEngineTransportPosition).toHaveBeenCalledOnce();
        expect(programmeOpen(driven.gate)).toBe(true);
    });

    it('reopens the programme on Stop when a declined start boots an engine during the audition', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            engineIncarnation: null,
        });
        const playback = audition();
        await playback.ready;
        expect(programmeOpen(driven.gate)).toBe(false);
        expect(driven.sources[0]?.start).toHaveBeenCalledOnce();
        bootedWithoutBackend();
        await playback.stop();
        expect(programmeOpen(driven.gate)).toBe(true);
        expect(getEngineTransportPosition).toHaveBeenCalledOnce();
    });

    it('keeps exactly one recovery pending across a refused user Stop', async () => {
        const apply = refusingSession(2);
        const playback = audition();
        await playback.ready;
        await expect(playback.stop()).rejects.toThrow('native output gate refused');
        // A refused user Stop replaces the pending recovery and arms its own.
        await expect(playback.stop()).rejects.toThrow('native output gate refused');
        await idle();
        expect(apply).toHaveBeenCalledTimes(3);
        expect(programmeOpen(driven.gate)).toBe(false);
        await sessionCommand();
        await vi.waitFor(() => expect(programmeOpen(driven.gate)).toBe(true));
        expect(apply).toHaveBeenCalledTimes(4);
        await sessionCommand();
        await idle();
        expect(apply).toHaveBeenCalledTimes(4);
    });

    it('ends the pending recovery when the user presses Stop', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const apply = refusingSession(1);
        const first = audition();
        await first.ready;
        await expect(first.stop()).rejects.toThrow('native output gate refused');
        const second = audition();
        await second.ready;
        driven.sources[1]?.stop.mockImplementation(() => {
            throw new Error('source stop failed');
        });
        await expect(second.stop()).rejects.toThrow('source stop failed');
        // The user's own Stop meets the unsafe context and arms nothing; the earlier recovery is over.
        await expect(first.stop()).rejects.toThrow('Reload to restore listening');
        await sessionCommand();
        await idle();
        const recoveryReports = warn.mock.calls.filter(
            ([error]) =>
                error instanceof Error &&
                error.cause instanceof Error &&
                error.cause.message === 'Audition source cleanup failed. Reload to restore listening.'
        );
        expect(recoveryReports).toHaveLength(0);
        expect(apply).toHaveBeenCalledTimes(3);
        warn.mockRestore();
    });

    it('sends nothing native from a release that timed out waiting for the session queue head', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const apply = refusingSession(0);
        const playback = audition();
        await playback.ready;
        const reopen = vi.spyOn(driven.engine, 'setAudioPreviewProgrammeSuppressed');
        const blocker = Promise.withResolvers<void>();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const blocked = queueOnNativeLiveGraphSession(() => blocker.promise);
            const stopped = playback.stop();
            await vi.advanceTimersByTimeAsync(10_000);
            await expect(stopped).rejects.toThrow('readiness timed out');
            expect(apply).toHaveBeenCalledTimes(1);
            blocker.resolve();
            await blocked;
            // The stale attempt reaches the head first and gives up; the recovery the blocker's
            // settlement starts is the only one that addresses the engine.
            await vi.advanceTimersByTimeAsync(100);
            await vi.waitFor(() => expect(programmeOpen(driven.gate)).toBe(true));
        } finally {
            vi.useRealTimers();
        }
        await idle();
        expect(apply).toHaveBeenCalledTimes(2);
        expect(reopen.mock.calls.filter(([suppressed]) => !suppressed)).toHaveLength(1);
        warn.mockRestore();
    });

    it('a superseded audition stop leaves its successor owning the output', async () => {
        const first = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        await first.ready;
        const second = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        const successor = nativeLiveGraphSession.auditionOwner;
        await second.ready;
        await first.stop();
        expect(successor).not.toBeNull();
        expect(nativeLiveGraphSession.auditionOwner).toBe(successor);
        expect(programmeOpen(driven.gate)).toBe(false);
        expect(driven.sources[1]?.start).toHaveBeenCalledOnce();
        expect(driven.sources[1]?.stop).not.toHaveBeenCalled();
        await second.stop();
        expect(programmeOpen(driven.gate)).toBe(true);
    });

    it('still refuses an audition start while an abandoned native programme is unsettled', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const orphan = { backendId: 'native/live', apply: vi.fn<AudioGraphBackend['apply']>(), dispose: vi.fn() };
        Object.assign(nativeLiveGraphSession, { orphanedBackend: orphan });
        const playback = playExclusiveAudioBufferPreview({
            buffer: buffer(),
            gain: 1,
            isCurrent: () => true,
            onEnded: vi.fn(),
        });
        await expect(playback.ready).rejects.toThrow('has not settled into an owned listening session');
        expect(driven.sources).toHaveLength(0);
        expect(orphan.apply).not.toHaveBeenCalled();
    });

    it('an older deferred native start installs without cancelling the newer A/B owner', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const topology = Promise.withResolvers<AudioGraphApplyResult>();
        let fence = 1;
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockImplementation(async () => applied(++fence))
            .mockReturnValueOnce(topology.promise);
        fixture.startBackend = nativeStartBackend(apply);
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
        expect(programmeOpen(driven.gate)).toBe(false);
        topology.resolve(applied(1));
        await expect(start).resolves.toMatchObject({ outcome: 'started' });
        await playback.ready;
        expect(driven.sources[0]?.start).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenLastCalledWith({
            schemaVersion: 1,
            commands: [{ kind: 'set-monitor-shadow', shadowed: true }],
        });
        await playback.stop();
        expect(programmeOpen(driven.gate)).toBe(true);
    });

    it('a newer native start cancels an A/B still acquiring before that start reaches its queue', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        const gate = Promise.withResolvers<AudioGraphApplyResult>();
        let fence = 1;
        const apply = vi
            .fn<AudioGraphBackend['apply']>()
            .mockImplementation(async () => applied(++fence))
            .mockReturnValueOnce(gate.promise);
        fixture.startBackend = nativeStartBackend(apply);
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
        fixture.startBackend = nativeStartBackend(apply);
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
        fixture.startBackend = nativeStartBackend(apply);
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
        expect(programmeOpen(driven.gate)).toBe(true);
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
        expect(programmeOpen(driven.gate)).toBe(false);
        expect(driven.sources).toHaveLength(1);
    });
});
