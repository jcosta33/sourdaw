import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { liveMidiProcessor } from '../../scheduling/liveMidiProcessor';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { scheduleAudioClips } from '../../scheduling/scheduleAudioClips';
import { scheduleMidiNotes } from '../../scheduling/scheduleMidiNotes';
import { executePlayheadSeek } from '../../transportControls/executePlayheadSeek';
import { notePanicParticipants } from '../../transportControls/notePanicParticipants';
import { pausePlayback } from '../../transportControls/pausePlayback';
import { createLoopAudioSchedule } from '../createLoopAudioSchedule';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { fenceSource } from '../fenceSource';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';
import { stopPlayheadScheduler } from '../stopPlayheadScheduler';

/**
 * #6277: a recovered playhead does not prove that the buffer at a missed seam
 * existed before the main thread stalled. These cases keep the real scheduler,
 * audio/frozen emitters, source-time projection and MIDI window dispatcher.
 * The browser source ledger proves submitted playback intervals, not PCM.
 */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: ReturnType<typeof createTrack>[] } | null } = { value: { tracks: [] } };
const envelopeState: {
    value: { envelopes: Record<string, { enabled: boolean; points: { beatOffset: number; gainDb: number }[] }> } | null;
} = { value: null };
const midiStoreState: {
    value: {
        notesByClipId: Record<string, unknown[]>;
        ccByClipId: Record<string, unknown[]>;
        pitchBendByClipId: Record<string, unknown[]>;
        probabilitySeed: number;
    } | null;
} = { value: null };
const ctxTime = { now: 0 };
const sourceStartClockAdvance = { armed: false, seconds: 0, invocations: 0 };
const gainFailure = { enabled: false };
const compensation = { seconds: 0 };

const audioContextStub = {
    sampleRate: 48000,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({
        connect: () => {},
        disconnect: () => {},
        gain: {
            value: 1,
            cancelScheduledValues: () => {},
            cancelAndHoldAtTime: () => {},
            setValueAtTime: () => {},
            exponentialRampToValueAtTime: () => {},
            linearRampToValueAtTime: () => {
                if (gainFailure.enabled) {
                    throw new Error('Fixture gain submission failed');
                }
            },
        },
    }),
};

const trackStripStub = {
    gainNode: {},
    deviceNodes: [] as unknown[],
    preFaderTap: { connect: () => {} },
};

const loggedError = vi.hoisted(() => vi.fn());
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: loggedError, warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRootIdentity: vi.fn<typeof import('#/modules/CrdtDocument/useCases').captureProjectRootIdentity>(
        () => 'root-identity'
    ),
}));
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    appendClipToTrack: vi.fn<typeof import('#/modules/Arrangement/stores').appendClipToTrack>(),
    clipSelectionStore: { value: null },
    resolveEligibleClipWriteTarget: vi.fn<typeof import('#/modules/Arrangement/stores').resolveEligibleClipWriteTarget>(
        () => ({ status: 'ineligible' })
    ),
    updateClipInStore: vi.fn(() => false),
    adjustmentLayerStore: { value: null },
    gainEnvelopeStore: {
        get value() {
            return envelopeState.value;
        },
    },
    getTrackEligibility: vi.fn(),
    markerStore: { value: null },
    vcaGroupStore: { value: null },
    warpStateStore: { value: null },
    trackStore: {
        subscribe: () => () => {},
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: { value: { lanes: [] } },
    activeRecordingRef: { current: [] },
    getGainEnvelopeSeries: (clipId: string) => {
        const envelope = envelopeState.value?.envelopes[clipId];
        return envelope?.enabled ? envelope.points : null;
    },
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return midiStoreState.value;
        },
    },
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiState: vi.fn(),
}));
vi.mock('../../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return transportStoreState.value;
        },
        set(next: typeof defaultTransportState | null) {
            transportStoreState.value = next;
        },
    },
}));
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return tempoMapStoreState.value;
        },
    },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/Toaster/stores', () => ({ toasterStore: { value: null } }));
vi.mock('#/modules/Automation/stores', () => ({
    modulationStore: { value: null },
    automationStore: { value: null },
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    startAutomationRecording: vi.fn(),
    stopAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        createTrack: actual.createTrack,
        resolveClipsWithComping: actual.resolveClipsWithComping,
        captureRecordingCommitRetirement: () => {
            throw new Error('This playback fixture must not admit a recording commit');
        },
        hasAutomaticRecordingMidiCapture: () => {
            throw new Error('This playback fixture must not query an automatic MIDI owner');
        },
        collaborationAssetTransfer: {
            read: () => ({ isSessionActive: () => false, current: () => null }),
        },
        takeOwnsRecordingRoot: vi.fn(() => true),
        prepareRecoveredRecording: vi.fn(),
        admitRecordingCaptureClock: vi.fn(),
        observeRecordingPassEntry: vi.fn(),
        discardRecording: vi.fn(),
        startRecording: vi.fn(() => []),
        stopRecording: vi.fn(),
        addTakeLane: vi.fn(),
        addTake: vi.fn(),
        stageRecordingTake: vi.fn(),
        commitRecording: vi.fn(),
        updateClip: vi.fn(),
        getSynthParamsForTrack: () => ({}),
    };
});

type Start = {
    when: number;
    offset: number;
    duration: number | undefined;
    rate: number;
    requestedAt: number;
};
type Stop = { when: number; requestedAt: number };
type SourceLedger = {
    bufferId: string;
    buffer: AudioBuffer | null;
    start: Start | null;
    stops: Stop[];
    bufferDuration: number;
};
type SourceSnapshot = Omit<SourceLedger, 'stops' | 'start'> & { start: Start; stops: Stop[] };
const sourceLedger = vi.hoisted(() => [] as SourceLedger[]);
const buffers = vi.hoisted(() => new Map<string, AudioBuffer>());
const scheduleClickSpy = vi.hoisted(() => vi.fn());
const scheduleNoteSpy = vi.hoisted(() => vi.fn());

function createSource() {
    const ledger: SourceLedger = { bufferId: '', buffer: null, start: null, stops: [], bufferDuration: 0 };
    sourceLedger.push(ledger);
    const source = {
        buffer: null as AudioBuffer | null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start(when: number, offset = 0, duration?: number) {
            if (!source.buffer || !Number.isFinite(when) || !Number.isFinite(offset) || offset < 0) {
                throw new Error('The scheduler must supply a cached buffer and finite source timing');
            }
            if (ledger.start || (duration !== undefined && (!Number.isFinite(duration) || duration <= 0))) {
                throw new Error('A source starts once with a positive duration');
            }
            ledger.bufferId = [...buffers].find(([, buffer]) => buffer === source.buffer)?.[0] ?? 'unknown';
            ledger.bufferDuration = source.buffer.duration;
            ledger.buffer = source.buffer;
            ledger.start = { when, offset, duration, rate: source.playbackRate.value, requestedAt: ctxTime.now };
            if (sourceStartClockAdvance.armed) {
                sourceStartClockAdvance.armed = false;
                sourceStartClockAdvance.invocations++;
                ctxTime.now += sourceStartClockAdvance.seconds;
            }
        },
        stop(when = ctxTime.now) {
            if (!ledger.start || !Number.isFinite(when)) {
                throw new Error('Only a started source can receive a finite stop');
            }
            ledger.stops.push({ when: Math.max(when, ctxTime.now), requestedAt: ctxTime.now });
        },
        onended: null,
    };
    return source;
}

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    builtinSynthVoice: { read: () => synthVoices },
    ensureCachedAudioBuffersDurable: vi.fn(),
    createNativeRecordingCaptureClock: () => ({ last: null, read: () => ({ carrier: 'browser' as const }) }),
    analyzePitchForClip: vi.fn(),
    ensureBusStrip: vi.fn(),
    getEngineState: vi.fn(),
    removeSend: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    wireSidechainRoute: vi.fn(),
    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    getAudioContext: () => audioContextStub,
    getCurrentTime: () => ctxTime.now,
    scheduleClick: scheduleClickSpy,
    getCompensationDelay: () => compensation.seconds,
    getDefaultBendRangeSemitones: () => 48,
    getNoteExpressionDimensions: () => [],
    getDrumKitByIndex: () => null,
    ensureTrackStrip: () => trackStripStub,
    getTrackStrip: () => trackStripStub,
    applyNoteExpression: vi.fn(),
    startNoteExpression: vi.fn(),
    advanceNoteExpression: vi.fn(),
    relocateNoteExpression: vi.fn(),
    registerScheduledSource: vi.fn(),
    scheduleFaustNote: vi.fn(),
    audioEngine: { setTransportInfo: vi.fn(), beginAudioPreviewIntent: () => ({ release: vi.fn() }) },
    repositionNativeLiveGraphSession: () => Promise.resolve(false),
    stopNativeLiveGraphSession: () => Promise.resolve(false),
    stopAllScheduled: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    createBufferSource: createSource,
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => buffers.get(bufferId) ?? null,
    getFactoryDrumKitByIndex: vi.fn(),
    readNativeEnginePlayheadSeconds: (): number | null => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
// The built-in synth voice this spec's notes sound through, read through the AudioEngine port.
const synthVoices = vi.hoisted(() => ({
    getDrumKitDefByIndex: () => null,
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: scheduleNoteSpy,
    getSynthParamsFromDevices: vi.fn(() => ({})),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    isFaustInstrumentModule: () => false,
}));
vi.mock('#/modules/Yeast/useCases', () => ({
    hydrateYeastCrdtProjection: vi.fn(),
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));

const settleGeneratedNotes = async () => {};
const readRackProcessors = () => [];
liveMidiProcessor.configure({ processBlock: processYeastMidi, readRackProcessors });
const SAMPLE_RATE = 48_000;
const ANCHOR_FRAME = 480_000;
const STALL_FRAMES = 9_600;
const TICK_FRAMES = 1_200;

type SchedulerWorkerHarness = { onmessage: ((event: { data: unknown }) => void) | null };
let workerHarness: SchedulerWorkerHarness | null = null;
let tickSequence = 0;

function snapshotSources(): SourceSnapshot[] {
    return sourceLedger.flatMap((source): SourceSnapshot[] => {
        if (!source.start) {
            return [];
        }
        return [
            {
                bufferId: source.bufferId,
                buffer: source.buffer,
                bufferDuration: source.bufferDuration,
                start: {
                    when: source.start.when,
                    offset: source.start.offset,
                    duration: source.start.duration,
                    rate: source.start.rate,
                    requestedAt: source.start.requestedAt,
                },
                stops: source.stops.map((stop) => ({ when: stop.when, requestedAt: stop.requestedAt })),
            },
        ];
    });
}

function frame(seconds: number): number {
    return Math.round(seconds * SAMPLE_RATE);
}

function effectiveEnd(source: SourceSnapshot): number {
    const { start } = source;
    const available = source.bufferDuration - start.offset;
    const naturalEnd = start.when + Math.min(start.duration ?? available, available) / start.rate;
    // Web Audio replaces a pending stop with the most recently submitted stop.
    return Math.min(naturalEnd, source.stops.at(-1)?.when ?? Infinity);
}

async function tickAt(relativeFrame: number, expectedError?: string, clockIsReset = false): Promise<void> {
    ctxTime.now = (ANCHOR_FRAME + relativeFrame) / SAMPLE_RATE;
    const dispatchAudioTime = ctxTime.now;
    const receivedAtMs = performance.timeOrigin + performance.now();
    if (!workerHarness?.onmessage) {
        throw new Error('The real scheduler must have installed its worker callback');
    }
    workerHarness.onmessage({
        data: {
            type: 'tick',
            generation: schedulerSession.generation,
            sequence: ++tickSequence,
            scheduledAtMs: receivedAtMs - 2,
            sentAtMs: receivedAtMs - 1,
        },
    });
    // Admission is synchronous; settlement and clock publication are observable.
    expect(schedulerSession.tickInFlight).toBe(!clockIsReset);
    await vi.waitFor(
        () => {
            expect(schedulerSession.tickInFlight).toBe(false);
            expect(playheadClockRef.audioTimeSeconds).toBe(clockIsReset ? 0 : dispatchAudioTime);
            if (expectedError) {
                expect(loggedError).toHaveBeenCalledOnce();
                expect(loggedError.mock.calls[0]?.[0]?.cause?.message).toBe(expectedError);
            } else {
                expect(loggedError).not.toHaveBeenCalled();
            }
        },
        { interval: 1 }
    );
}

function seedTrack(id: string, loopEnd: number, frozen: boolean, sourceEntry: number, frozenMidi = false) {
    const track = createTrack({ id, name: id, kind: frozenMidi ? 'midi' : 'audio', withoutDefaultDevice: true });
    const bufferId = `${id}-buffer`;
    // Only browser media/hardware is doubled; the real comp resolver reads this clip.
    buffers.set(bufferId, { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
    track.clips = [
        {
            id: `${id}-clip`,
            trackId: id,
            name: id,
            type: 'audio',
            startBeat: 0,
            endBeat: loopEnd,
            audioBufferId: bufferId,
            audioOffsetSeconds: sourceEntry,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#abcdef',
            locked: false,
            muted: false,
        },
    ];
    if (frozen) {
        track.freezeState = { status: 'frozen', frozenBufferId: bufferId, compensationSeconds: 0 };
    }
    return track;
}

function assertPassAlreadySubmitted(
    snapshot: readonly SourceSnapshot[],
    relativeStartFrame: number,
    passFrames: number,
    lastRefillFrame: number,
    frozen: boolean
): void {
    const starts = snapshot.filter((source) => frame(source.start.when) === ANCHOR_FRAME + relativeStartFrame);
    const expected = ['left', 'right'].map((id, index) => ({
        bufferId: `${id}-buffer`,
        whenFrame: ANCHOR_FRAME + relativeStartFrame,
        offsetFrame: frozen ? 0 : [18_000, 54_000][index],
        durationFrames: frozen ? null : passFrames,
        rate: 1,
        endsAtFrame: ANCHOR_FRAME + relativeStartFrame + passFrames,
    }));
    expect
        .soft(
            starts.map((source) => ({
                bufferId: source.bufferId,
                whenFrame: frame(source.start.when),
                offsetFrame: frame(source.start.offset),
                durationFrames: source.start.duration === undefined ? null : frame(source.start.duration),
                rate: source.start.rate,
                endsAtFrame: frame(effectiveEnd(source)),
            })),
            `pass at relative frame ${relativeStartFrame} must exist BEFORE the ${STALL_FRAMES}-frame stall`
        )
        .toEqual(expected);
    for (const source of starts) {
        expect.soft(source.start.when).toBeCloseTo((ANCHOR_FRAME + relativeStartFrame) / SAMPLE_RATE, 12);
        expect.soft(frame(source.start.requestedAt)).toBeLessThanOrEqual(ANCHOR_FRAME + lastRefillFrame);
        for (const stop of source.stops) {
            expect.soft(frame(stop.requestedAt)).toBeLessThanOrEqual(ANCHOR_FRAME + lastRefillFrame);
        }
    }
}

type SeamStallOptions = { noteStartBeat?: number; compensationSeconds?: number };

async function reproduceSeamStall(
    passFrames: number,
    lastRefillFrame: number,
    frozen: boolean,
    frozenMidi = false,
    options: SeamStallOptions = {}
): Promise<void> {
    const loopEnd = passFrames / 24_000; // Fixed fixture:120BPM means24000frames per quarter-note beat.
    const left = seedTrack('left', loopEnd, frozen, 0.375, frozenMidi);
    const right = seedTrack('right', loopEnd, frozen, 1.125, frozenMidi);
    if (frozenMidi && !frozen) {
        left.clips.push({ ...left.clips[0]!, id: 'left-midi', type: 'midi', audioBufferId: undefined });
        midiStoreState.value!.notesByClipId['left-midi'] = [
            {
                id: 'mixed-note',
                pitch: 60,
                startBeat: options.noteStartBeat ?? 0,
                duration: 0.05,
                velocity: 100,
                probability: 100,
            },
        ];
    }
    trackStoreState.value = {
        tracks: [left, right],
    };
    transportStoreState.value = {
        ...defaultTransportState,
        isPlaying: true,
        tempo: 120,
        playheadPosition: 0,
        isLooping: true,
        loopStart: 0,
        loopEnd,
        metronomeEnabled: false,
    };
    startPlayheadScheduler();
    await tickAt(0);
    // Prove fixture admission before making any continuity claim.
    const initial = snapshotSources().filter((source) => frame(source.start.when) === ANCHOR_FRAME);
    expect(initial.map((source) => source.bufferId)).toEqual(['left-buffer', 'right-buffer']);
    expect(initial.map((source) => frame(source.start.offset))).toEqual(frozen ? [0, 0] : [18_000, 54_000]);
    for (let tickFrame = TICK_FRAMES; tickFrame < lastRefillFrame; tickFrame += TICK_FRAMES) {
        await tickAt(tickFrame);
    }
    await tickAt(lastRefillFrame);
    expect(schedulerSession.tickInFlight).toBe(false);
    const beforeStall = snapshotSources();
    // Copy before advancing the clock: recovery cannot retroactively pass this oracle.
    const recoveryFrame = lastRefillFrame + STALL_FRAMES;
    const crossedSeams = Math.floor(recoveryFrame / passFrames);
    for (let pass = 1; pass <= crossedSeams; pass++) {
        assertPassAlreadySubmitted(beforeStall, pass * passFrames, passFrames, lastRefillFrame, frozen);
    }
    // Every outgoing pass also ends at its own seam, including long frozen media.
    for (let pass = 0; pass < crossedSeams; pass++) {
        const outgoing = beforeStall.filter((source) => frame(source.start.when) === ANCHOR_FRAME + pass * passFrames);
        expect
            .soft(outgoing.map((source) => frame(effectiveEnd(source))))
            .toEqual([ANCHOR_FRAME + (pass + 1) * passFrames, ANCHOR_FRAME + (pass + 1) * passFrames]);
    }

    const emissionCountBeforeRecovery = scheduleNoteSpy.mock.calls.length;
    const pitch60CallsBeforeRecovery = scheduleNoteSpy.mock.calls.filter((call) => call[2] === 60);
    const pitch60EmissionsBeforeRecovery = pitch60CallsBeforeRecovery.length;
    const preRecoveryPitch60Frames = pitch60CallsBeforeRecovery.map((call) => frame(call[3]));
    compensation.seconds = options.compensationSeconds ?? 0;
    await tickAt(recoveryFrame);
    const pitch60EmissionsAfterRecovery = scheduleNoteSpy.mock.calls.filter((call) => call[2] === 60).length;
    const recoveryPitch60Frames = scheduleNoteSpy.mock.calls
        .slice(emissionCountBeforeRecovery)
        .filter((call) => call[2] === 60)
        .map((call) => frame(call[3]));
    expect(playheadWrapCountRef.current).toBe(crossedSeams);
    expect(playheadClockRef.beat).toBeCloseTo((recoveryFrame % passFrames) / 24_000, 12);
    const afterRecovery = snapshotSources();
    if (compensation.seconds === 0) {
        for (let pass = 1; pass <= crossedSeams; pass++) {
            const seamFrame = ANCHOR_FRAME + pass * passFrames;
            const scheduled = afterRecovery.filter((source) => frame(source.start.when) === seamFrame);
            // One source per track, with no recovery-time duplicate at the seam or late in the pass.
            expect.soft(scheduled.map((source) => source.bufferId)).toEqual(['left-buffer', 'right-buffer']);
            const nextSeam = seamFrame + passFrames;
            expect
                .soft(
                    afterRecovery.filter((source) => {
                        const onset = frame(source.start.when);
                        return onset > seamFrame && onset < Math.min(nextSeam, ANCHOR_FRAME + recoveryFrame + 1);
                    })
                )
                .toEqual([]);
            expect.soft(scheduled.map((source) => frame(effectiveEnd(source)))).toEqual([nextSeam, nextSeam]);
        }
    }
    return {
        emissionCountBeforeRecovery,
        pitch60EmissionsBeforeRecovery,
        pitch60EmissionsAfterRecovery,
        preRecoveryPitch60Frames,
        recoveryPitch60Frames,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(processYeastMidi).mockImplementation(async (block) => [...block.events]);
    sourceStartClockAdvance.armed = false;
    sourceStartClockAdvance.seconds = 0;
    sourceStartClockAdvance.invocations = 0;
    gainFailure.enabled = false;
    compensation.seconds = 0;
    disposePlayheadScheduler();
    sourceLedger.length = 0;
    buffers.clear();
    ctxTime.now = ANCHOR_FRAME / SAMPLE_RATE;
    tickSequence = 0;
    workerHarness = null;
    tempoMapStoreState.value = { changes: [] };
    trackStoreState.value = { tracks: [] };
    envelopeState.value = null;
    midiStoreState.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {}, probabilitySeed: 1 };
    metronomeSchedulingState.lastBeat = -1;
    metronomeSchedulingState.firedClickTimes.clear();
    playheadWrapCountRef.current = 0;
    notePanicParticipants.configure({ settleGeneratedNotes, voiceReleases: [] });
    vi.stubGlobal(
        'Worker',
        class {
            onmessage: ((event: { data: unknown }) => void) | null = null;
            constructor() {
                const readCallback = () => this.onmessage;
                workerHarness = {
                    get onmessage() {
                        return readCallback();
                    },
                };
            }
            postMessage = vi.fn();
            terminate = vi.fn();
            addEventListener = vi.fn();
            removeEventListener = vi.fn();
        }
    );
});

afterEach(() => {
    disposePlayheadScheduler();
    vi.unstubAllGlobals();
});

describe('browser buffer admission before a loop-seam main-thread stall (#6277)', () => {
    it.each([false, true])('pre-submits the2s-loop successor before a200ms stall (frozen=%s)', async (frozen) => {
        // At1.875s the existing100ms window stops at1.975s, before the2s seam.
        await reproduceSeamStall(96_000, 90_000, frozen);
    });
    it.each([false, true])('pre-submits both125ms-loop successors before a200ms stall (frozen=%s)', async (frozen) => {
        // A1/16-note loop at120BPM lasts6000frames. The task crosses both6000 and12000.
        // Current+one successor ends at12000; recovery at15552 must already be covered.
        await reproduceSeamStall(6_000, 5_952, frozen);
    });
    it('shares frozen MIDI pass ownership with the real MIDI dispatcher', async () => {
        await reproduceSeamStall(6_000, 5_952, true, true);
        expect(scheduleNoteSpy).not.toHaveBeenCalled();
    });
    it('emits exactly one fresh MIDI note at the recovery pass onset', async () => {
        const {
            pitch60EmissionsBeforeRecovery,
            pitch60EmissionsAfterRecovery,
            preRecoveryPitch60Frames,
            recoveryPitch60Frames,
        } = await reproduceSeamStall(6_000, 5_952, false, true);
        expect(pitch60EmissionsAfterRecovery).toBeGreaterThan(pitch60EmissionsBeforeRecovery);
        expect(recoveryPitch60Frames).toEqual([ANCHOR_FRAME + 18_000]);
        expect(new Set(preRecoveryPitch60Frames).size).toBe(preRecoveryPitch60Frames.length);
        expect(preRecoveryPitch60Frames).not.toContain(ANCHOR_FRAME + 18_000);
    });
    it.each([
        {
            label: 'future under positive compensation',
            compensationSeconds: 0.1,
            currentOnset: 499_200,
            nextOnset: 505_200,
        },
        {
            label: 'exactly due under positive compensation',
            compensationSeconds: 0.024,
            currentOnset: 495_552,
            nextOnset: 501_552,
        },
        {
            label: 'genuinely past without compensation',
            compensationSeconds: 0,
            currentOnset: null,
            nextOnset: 500_400,
        },
        {
            label: 'genuinely past under negative compensation',
            compensationSeconds: -0.05,
            currentOnset: null,
            nextOnset: 498_000,
        },
    ])('admits a recovered note only when its audible onset is $label', async (scenario) => {
        const { emissionCountBeforeRecovery, recoveryPitch60Frames } = await reproduceSeamStall(
            6_000,
            5_952,
            false,
            true,
            { noteStartBeat: 0.1, compensationSeconds: scenario.compensationSeconds }
        );
        expect(recoveryPitch60Frames).toEqual(scenario.currentOnset === null ? [] : [scenario.currentOnset]);

        // Open the next window so the following pass's occurrence is due too.
        await tickAt(16_752);
        const emittedDuringRecovery = scheduleNoteSpy.mock.calls
            .slice(emissionCountBeforeRecovery)
            .filter((call) => call[2] === 60)
            .map((call) => frame(call[3]));
        expect(emittedDuringRecovery).toEqual(
            scenario.currentOnset === null ? [scenario.nextOnset] : [scenario.currentOnset, scenario.nextOnset]
        );
    });
});

describe('mixed MIDI media ownership during non-loop playback', () => {
    it('rejoins the residual original after an uncached frozen bake is removed', async () => {
        const mixed = seedTrack('left', 0.15, false, 0, true);
        const unrelated = seedTrack('right', 4, false, 0.25);
        mixed.freezeState = { status: 'frozen', frozenBufferId: 'missing-bake', compensationSeconds: 0 };
        trackStoreState.value = { tracks: [mixed, unrelated] };
        transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };

        startPlayheadScheduler();
        await tickAt(0);
        expect(snapshotSources().map((source) => source.bufferId)).toEqual(['right-buffer']);

        mixed.freezeState = { status: 'unfrozen' };
        await tickAt(1_200);
        const original = snapshotSources().filter((source) => source.bufferId === 'left-buffer');
        expect(original).toHaveLength(1);
        expect(frame(original[0]!.start.when)).toBe(ANCHOR_FRAME + 1_200);
        expect(frame(original[0]!.start.offset)).toBe(1_200);
        const unrelatedAfter = snapshotSources().filter((source) => source.bufferId === 'right-buffer');
        expect(unrelatedAfter).toHaveLength(1);
        expect(unrelatedAfter[0]!.stops).toHaveLength(0);
    });

    it('rejoins a short audio tail between the playhead and the existing look-ahead after unfreeze', async () => {
        const mixed = seedTrack('left', 0.15, false, 0, true);
        buffers.set('bake', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
        trackStoreState.value = { tracks: [mixed] };
        transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };

        startPlayheadScheduler();
        await tickAt(0);
        expect(snapshotSources().map((source) => source.bufferId)).toEqual(['left-buffer']);
        mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0 };
        await tickAt(1_200);
        expect(snapshotSources().filter((source) => source.bufferId === 'bake')).toHaveLength(1);

        mixed.freezeState = { status: 'unfrozen' };
        await tickAt(2_400);
        const sources = snapshotSources();
        const original = sources.filter((source) => source.bufferId === 'left-buffer');
        const bake = sources.find((source) => source.bufferId === 'bake');
        expect(original).toHaveLength(2);
        expect(frame(original[1]!.start.when)).toBe(ANCHOR_FRAME + 2_400);
        expect(frame(original[1]!.start.offset)).toBe(2_400);
        expect(frame(effectiveEnd(bake!))).toBeLessThanOrEqual(frame(original[1]!.start.when));
    });

    it.each(['waiting-first', 'mixed-first'] as const)(
        'hands off an unfrozen original around a held MIDI rack await (%s)',
        async (order) => {
            const mixed = seedTrack('left', 0.4, false, 0, true);
            const waiting = createTrack({ id: 'waiting', name: 'waiting', kind: 'midi', withoutDefaultDevice: true });
            waiting.devices = [
                { id: 'waiting-rack', name: 'waiting', type: 'yeast', bypassed: false, parameterValues: {} },
            ];
            waiting.clips = [{ ...mixed.clips[0]!, id: 'waiting-clip', trackId: 'waiting', type: 'midi' }];
            midiStoreState.value!.notesByClipId['waiting-clip'] = [
                { id: 'waiting-note', pitch: 72, startBeat: 0, duration: 0.5, velocity: 100, probability: 100 },
            ];
            buffers.set('bake', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
            trackStoreState.value = { tracks: order === 'waiting-first' ? [waiting, mixed] : [mixed, waiting] };
            transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };
            startPlayheadScheduler();
            await tickAt(0);
            mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0 };
            await tickAt(1_200);
            expect(snapshotSources().filter((source) => source.bufferId === 'bake')).toHaveLength(1);
            vi.mocked(processYeastMidi).mockClear();

            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.mocked(processYeastMidi).mockImplementationOnce(async (block) => {
                await held;
                return [...block.events];
            });
            mixed.freezeState = { status: 'unfrozen' };
            ctxTime.now = (ANCHOR_FRAME + 2_400) / SAMPLE_RATE;
            const receivedAtMs = performance.timeOrigin + performance.now();
            if (!workerHarness?.onmessage) {
                throw new Error('The real scheduler must have installed its worker callback');
            }
            workerHarness.onmessage({
                data: {
                    type: 'tick',
                    generation: schedulerSession.generation,
                    sequence: ++tickSequence,
                    scheduledAtMs: receivedAtMs - 2,
                    sentAtMs: receivedAtMs - 1,
                },
            });
            try {
                await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledOnce(), { interval: 1 });
                expect(schedulerSession.tickInFlight).toBe(true);
                const during = snapshotSources();
                const original = during.filter((source) => source.bufferId === 'left-buffer');
                const bake = during.find((source) => source.bufferId === 'bake');
                if (order === 'mixed-first') {
                    expect(original).toHaveLength(2);
                    expect(bake?.stops).toHaveLength(1);
                    expect(frame(effectiveEnd(bake!))).toBeLessThanOrEqual(frame(original[1]!.start.when));
                } else {
                    expect(original).toHaveLength(1);
                    expect(bake?.stops).toHaveLength(0);
                }
                ctxTime.now += 0.005;
            } finally {
                release();
            }
            await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false), { interval: 1 });
            const sources = snapshotSources();
            const original = sources.filter((source) => source.bufferId === 'left-buffer');
            const bake = sources.find((source) => source.bufferId === 'bake');
            expect(original).toHaveLength(2);
            expect(bake?.stops).toHaveLength(1);
            expect(frame(effectiveEnd(bake!))).toBeLessThanOrEqual(frame(original[1]!.start.when));
        }
    );

    it('rejoins an uncached bake’s original before a later MIDI rack await', async () => {
        const mixed = seedTrack('left', 0.4, false, 0, true);
        const waiting = createTrack({ id: 'waiting', name: 'waiting', kind: 'midi', withoutDefaultDevice: true });
        waiting.devices = [
            { id: 'waiting-rack', name: 'waiting', type: 'yeast', bypassed: false, parameterValues: {} },
        ];
        waiting.clips = [{ ...mixed.clips[0]!, id: 'waiting-clip', trackId: 'waiting', type: 'midi' }];
        midiStoreState.value!.notesByClipId['waiting-clip'] = [
            { id: 'waiting-note', pitch: 72, startBeat: 0, duration: 0.5, velocity: 100, probability: 100 },
        ];
        mixed.freezeState = { status: 'frozen', frozenBufferId: 'missing-bake', compensationSeconds: 0 };
        trackStoreState.value = { tracks: [mixed, waiting] };
        transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };
        startPlayheadScheduler();
        await tickAt(0);
        expect(snapshotSources()).toEqual([]);
        vi.mocked(processYeastMidi).mockClear();

        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(processYeastMidi).mockImplementationOnce(async (block) => {
            await held;
            return [...block.events];
        });
        mixed.freezeState = { status: 'unfrozen' };
        ctxTime.now = (ANCHOR_FRAME + 1_200) / SAMPLE_RATE;
        const receivedAtMs = performance.timeOrigin + performance.now();
        if (!workerHarness?.onmessage) {
            throw new Error('The real scheduler must have installed its worker callback');
        }
        workerHarness.onmessage({
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence: ++tickSequence,
                scheduledAtMs: receivedAtMs - 2,
                sentAtMs: receivedAtMs - 1,
            },
        });
        try {
            await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledOnce(), { interval: 1 });
            const original = snapshotSources().filter((source) => source.bufferId === 'left-buffer');
            expect(original).toHaveLength(1);
            expect(frame(original[0]!.start.when)).toBe(ANCHOR_FRAME + 1_200);
            expect(frame(original[0]!.start.offset)).toBe(1_200);
        } finally {
            release();
        }
        await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false), { interval: 1 });
        expect(snapshotSources().filter((source) => source.bufferId === 'left-buffer')).toHaveLength(1);
    });

    it('cuts each previous owner at the replacement onset and restores the same bake after an unfreeze', async () => {
        const mixed = seedTrack('left', 4, false, 0, true);
        const unrelated = seedTrack('right', 4, false, 0.25);
        buffers.set('bake', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
        trackStoreState.value = { tracks: [mixed, unrelated] };
        transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };

        startPlayheadScheduler();
        await tickAt(0);
        expect(snapshotSources().map((source) => source.bufferId)).toEqual(['left-buffer', 'right-buffer']);

        mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0 };
        await tickAt(1_200);
        const afterFreeze = snapshotSources();
        const original = afterFreeze.find((source) => source.bufferId === 'left-buffer');
        const firstBake = afterFreeze.find((source) => source.bufferId === 'bake');
        expect(original).toBeDefined();
        expect(firstBake).toBeDefined();
        expect(original!.stops).toHaveLength(1);
        expect(frame(effectiveEnd(original!))).toBeLessThanOrEqual(frame(firstBake!.start.when));

        mixed.freezeState = { status: 'unfrozen' };
        await tickAt(2_400);
        const afterUnfreeze = snapshotSources();
        const resumed = afterUnfreeze.filter((source) => source.bufferId === 'left-buffer');
        const retiredBake = afterUnfreeze.find((source) => source.bufferId === 'bake');
        expect(resumed).toHaveLength(2);
        expect(frame(resumed[1]!.start.offset)).toBeGreaterThan(0);
        expect(retiredBake?.stops).toHaveLength(1);
        expect(frame(effectiveEnd(retiredBake!))).toBeLessThanOrEqual(frame(resumed[1]!.start.when));

        mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0 };
        await tickAt(3_600);
        const afterRefreeze = snapshotSources();
        const bakes = afterRefreeze.filter((source) => source.bufferId === 'bake');
        expect(bakes).toHaveLength(2);
        const resumedAfterRefreeze = afterRefreeze.filter((source) => source.bufferId === 'left-buffer')[1]!;
        expect(resumedAfterRefreeze.stops).toHaveLength(1);
        expect(frame(effectiveEnd(resumedAfterRefreeze))).toBeLessThanOrEqual(frame(bakes[1]!.start.when));
        await tickAt(4_800);
        expect(snapshotSources().filter((source) => source.bufferId === 'bake')).toHaveLength(2);

        const unrelatedAfter = snapshotSources().filter((source) => source.bufferId === 'right-buffer');
        expect(unrelatedAfter).toHaveLength(1);
        expect(unrelatedAfter[0]!.stops).toHaveLength(0);
    });

    it('retires a sounding owner exactly at the compensated frozen replacement onset', async () => {
        const mixed = seedTrack('left', 4, false, 0, true);
        buffers.set('bake', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
        trackStoreState.value = { tracks: [mixed] };
        transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };
        startPlayheadScheduler();
        await tickAt(0);
        expect(snapshotSources().filter((source) => source.bufferId === 'left-buffer')).toHaveLength(1);

        compensation.seconds = 0.5;
        mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0.5 };
        await tickAt(1_200);
        const after = snapshotSources();
        const old = after.find((source) => source.bufferId === 'left-buffer');
        const bake = after.find((source) => source.bufferId === 'bake');
        expect(old?.stops).toHaveLength(1);
        expect(bake).toBeDefined();
        expect(frame(bake!.start.when)).toBe(ANCHOR_FRAME + 24_000);
        expect(frame(old!.stops[0]!.when)).toBe(frame(bake!.start.when));
        expect(frame(effectiveEnd(old!))).toBe(frame(bake!.start.when));
    });

    it('moves a pending compensated stop to an earlier uncompensated resume and preserves later handoffs', async () => {
        const mixed = seedTrack('left', 4, false, 0, true);
        buffers.set('bake', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
        trackStoreState.value = { tracks: [mixed] };
        transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };
        startPlayheadScheduler();
        await tickAt(0);

        compensation.seconds = 0.5;
        mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0.5 };
        await tickAt(1_200);
        const afterFreeze = snapshotSources();
        const oldOriginal = afterFreeze.find((source) => source.bufferId === 'left-buffer')!;
        const firstBake = afterFreeze.find((source) => source.bufferId === 'bake')!;
        expect(oldOriginal.stops.map((stop) => frame(stop.when))).toEqual([504_000]);
        expect(frame(firstBake.start.when)).toBe(504_000);
        expect(firstBake.stops).toEqual([]);
        expect(frame(effectiveEnd(firstBake))).toBe(1_272_000);

        compensation.seconds = 0;
        mixed.freezeState = { status: 'unfrozen' };
        await tickAt(12_000);
        const afterUnfreeze = snapshotSources();
        const originals = afterUnfreeze.filter((source) => source.bufferId === 'left-buffer');
        const resumed = originals[1]!;
        expect(originals).toHaveLength(2);
        expect(frame(resumed.start.when)).toBe(492_000);
        expect(originals[0]!.stops.map((stop) => frame(stop.when))).toEqual([504_000, 492_000]);
        const retiredBake = afterUnfreeze.find((source) => source.bufferId === 'bake')!;
        expect(retiredBake.stops.map((stop) => frame(stop.when))).toEqual([492_000]);
        for (const source of [originals[0]!, retiredBake]) {
            expect(frame(effectiveEnd(source))).toBeLessThanOrEqual(frame(resumed.start.when));
        }

        mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0 };
        await tickAt(12_000);
        const afterRefreeze = snapshotSources();
        const bakes = afterRefreeze.filter((source) => source.bufferId === 'bake');
        expect(bakes).toHaveLength(2);
        expect(frame(bakes[1]!.start.when)).toBe(492_000);
        const resumedAfterRefreeze = afterRefreeze.filter((source) => source.bufferId === 'left-buffer')[1]!;
        expect(resumedAfterRefreeze.stops.map((stop) => frame(stop.when))).toEqual([492_000]);
        expect(frame(effectiveEnd(resumedAfterRefreeze))).toBeLessThanOrEqual(frame(bakes[1]!.start.when));

        await tickAt(13_200);
        expect(snapshotSources().filter((source) => source.bufferId === 'bake')).toHaveLength(2);
    });

    it('keeps an ordinary same-track loop fence when an overlapping clip joins the pass', () => {
        const track = seedTrack('left', 6, false, 0);
        track.clips[0]!.startBeat = 2;
        trackStoreState.value = { tracks: [track] };
        const scheduledAudio = new Set<string>();
        const scheduledFrozen = new Set<string>();
        const active: AudioBufferSourceNode[] = [];
        const transport = { ...defaultTransportState, tempo: 120, isLooping: true, loopStart: 0, loopEnd: 4 };
        ctxTime.now = 10;

        scheduleAudioClips(0, 4, 0, scheduledAudio, scheduledFrozen, active, transport, 10);
        expect(active).toHaveLength(1);
        expect(snapshotSources()[0]!.start.when).toBe(11);
        const firstKey = [...scheduledAudio][0]!;
        fenceSource(active[0]!, audioContextStub as unknown as BaseAudioContext, 12);
        expect(snapshotSources()[0]!.stops.map((stop) => stop.when)).toEqual([12]);

        track.clips.push({ ...track.clips[0]!, id: 'left-overlap', startBeat: 3, endBeat: 5 });
        scheduleAudioClips(0, 4, 0, scheduledAudio, scheduledFrozen, active, transport, 10);

        const after = snapshotSources();
        const first = after.find((source) => source.start.when === 11)!;
        const overlap = after.find((source) => source.start.when === 11.5)!;
        expect(after).toHaveLength(2);
        expect(first.stops.map((stop) => stop.when)).toEqual([12]);
        expect(overlap.stops).toEqual([]);
        expect(active).toHaveLength(2);
        expect(scheduledAudio).toHaveLength(2);
        expect(scheduledAudio.has(firstKey)).toBe(true);
    });

    it.each(['waiting-first', 'mixed-first'] as const)(
        'hands off a frozen replacement around a held MIDI rack await (%s)',
        async (order) => {
            const mixed = seedTrack('left', 4, false, 0, true);
            const waiting = createTrack({ id: 'waiting', name: 'waiting', kind: 'midi', withoutDefaultDevice: true });
            waiting.devices = [
                { id: 'waiting-rack', name: 'waiting', type: 'yeast', bypassed: false, parameterValues: {} },
            ];
            waiting.clips = [{ ...mixed.clips[0]!, id: 'waiting-clip', trackId: 'waiting', type: 'midi' }];
            midiStoreState.value!.notesByClipId['waiting-clip'] = [
                { id: 'waiting-note', pitch: 72, startBeat: 0, duration: 0.5, velocity: 100, probability: 100 },
            ];
            buffers.set('bake', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
            trackStoreState.value = { tracks: order === 'waiting-first' ? [waiting, mixed] : [mixed, waiting] };
            transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };
            startPlayheadScheduler();
            await tickAt(0);
            expect(snapshotSources().filter((source) => source.bufferId === 'left-buffer')).toHaveLength(1);
            vi.mocked(processYeastMidi).mockClear();

            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.mocked(processYeastMidi).mockImplementationOnce(async (block) => {
                await held;
                return [...block.events];
            });
            mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0 };
            ctxTime.now = (ANCHOR_FRAME + 1_200) / SAMPLE_RATE;
            const receivedAtMs = performance.timeOrigin + performance.now();
            if (!workerHarness?.onmessage) {
                throw new Error('The real scheduler must have installed its worker callback');
            }
            workerHarness.onmessage({
                data: {
                    type: 'tick',
                    generation: schedulerSession.generation,
                    sequence: ++tickSequence,
                    scheduledAtMs: receivedAtMs - 2,
                    sentAtMs: receivedAtMs - 1,
                },
            });
            try {
                await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledOnce(), { interval: 1 });
                expect(schedulerSession.tickInFlight).toBe(true);
                const during = snapshotSources();
                const old = during.find((source) => source.bufferId === 'left-buffer');
                const bake = during.find((source) => source.bufferId === 'bake');
                if (order === 'mixed-first') {
                    expect(old?.stops).toHaveLength(1);
                    expect(bake).toBeDefined();
                    expect(frame(bake!.start.when)).toBe(ANCHOR_FRAME + 1_200);
                    expect(frame(old!.start.when + old!.start.duration!)).toBe(576_000);
                    expect(frame(effectiveEnd(old!))).toBeLessThanOrEqual(frame(bake!.start.when));
                } else {
                    expect(old?.stops).toHaveLength(0);
                    expect(bake).toBeUndefined();
                }
                ctxTime.now += 0.04;
            } finally {
                release();
            }
            await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false), { interval: 1 });
            const after = snapshotSources();
            const old = after.find((source) => source.bufferId === 'left-buffer');
            const bake = after.find((source) => source.bufferId === 'bake');
            expect(old).toBeDefined();
            expect(bake).toBeDefined();
            expect(frame(effectiveEnd(old!))).toBeLessThanOrEqual(frame(bake!.start.when));
        }
    );
    it('cancels a future compensated source without touching another track’s future source', async () => {
        compensation.seconds = 0.5;
        const mixed = seedTrack('left', 4, false, 0, true);
        const unrelated = seedTrack('right', 4, false, 0);
        buffers.set('bake', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
        trackStoreState.value = { tracks: [mixed, unrelated] };
        transportStoreState.value = { ...defaultTransportState, isPlaying: true, tempo: 120, isLooping: false };
        startPlayheadScheduler();
        await tickAt(0);
        const before = snapshotSources();
        expect(before.map((source) => source.bufferId)).toEqual(['left-buffer', 'right-buffer']);
        expect(frame(before[0]!.start.when)).toBe(ANCHOR_FRAME + 24_000);

        mixed.freezeState = { status: 'frozen', frozenBufferId: 'bake', compensationSeconds: 0.5 };
        await tickAt(1_200);
        const after = snapshotSources();
        const old = after.find((source) => source.bufferId === 'left-buffer');
        const bake = after.find((source) => source.bufferId === 'bake');
        const other = after.find((source) => source.bufferId === 'right-buffer');
        expect(old?.stops).toHaveLength(1);
        expect(frame(old!.stops[0]!.when)).toBe(ANCHOR_FRAME + 1_200);
        expect(frame(old!.stops[0]!.when)).toBeLessThan(frame(old!.start.when));
        expect(bake?.start.when).toBeGreaterThanOrEqual(old!.stops[0]!.when);
        expect(other?.stops).toHaveLength(0);
    });
});

async function startShortLoop(frozen = false, loopEnd = 0.25) {
    const track = seedTrack('left', loopEnd, frozen, 0.375);
    if (frozen) {
        track.freezeState.compensationSeconds = compensation.seconds;
    }
    trackStoreState.value = { tracks: [track] };
    transportStoreState.value = {
        ...defaultTransportState,
        isPlaying: true,
        tempo: 120,
        isLooping: true,
        loopStart: 0,
        loopEnd,
    };
    startPlayheadScheduler();
    await tickAt(0);
    return track;
}

describe('queued loop audio preservation and retirement', () => {
    it('owns one mapped recovery unit after shortfall and replays its compensated slot without widening', () => {
        compensation.seconds = 0.5;
        const track = seedTrack('left', 4, false, 0.375);
        const outside = seedTrack('outside', 4, false, 0);
        outside.clips[0]!.startBeat = 1;
        trackStoreState.value = { tracks: [track, outside] };
        const input = {
            transport: {
                ...defaultTransportState,
                isPlaying: true,
                tempo: 120,
                isLooping: true,
                loopStart: 0,
                loopEnd: 4,
            },
            changes: [],
            position: 0,
            audioTime: 10,
        };
        let phase = 'shortfall';
        let reads = 0;
        const owner = createLoopAudioSchedule({
            context: audioContextStub as unknown as BaseAudioContext,
            isCurrent: () => true,
            monotonicTime: () => {
                if (phase === 'ordinary') {
                    return 0;
                }
                reads++;
                if (phase === 'shortfall') {
                    return reads === 1 ? 0 : 40;
                }
                return reads === 1 ? 50 : 57;
            },
        });
        expect(owner.refill(input).shortfall).toBe('time-budget');
        expect(snapshotSources()).toEqual([]);
        phase = 'recovery';
        reads = 0;
        const pool = owner.poolAt(10);
        expect(owner.recoverMappedWindow(pool, 0, 0.2, input)).toBe(true);
        expect(owner.recoverMappedWindow(pool, 0.2, 0.4, input)).toBe(false);
        const before = snapshotSources();
        expect(before).toHaveLength(1);
        expect(before[0]!.start.when).toBe(10.5);
        expect(owner.coverage.shortfall).toBe('time-budget');
        expect(owner.coverage.through).toBe(10);
        expect(owner.coverage.recovery?.elapsedMilliseconds).toBe(7);
        buffers.set('left-buffer', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
        ctxTime.now = 10.02;
        phase = 'ordinary';
        owner.refill({ ...input, position: 0.04, audioTime: 10.02 });
        const after = snapshotSources();
        expect(after[0]!.stops.at(-1)?.when).toBe(10.02);
        const replacement = after.slice(before.length).find((source) => source.start.when === 10.5);
        expect(replacement?.buffer).toBe(buffers.get('left-buffer'));
        expect(replacement?.start.offset).toBe(0.375);
        expect(effectiveEnd(replacement!)).toBe(12.5);
        expect(after.some((source) => source.bufferId === 'outside-buffer')).toBe(false);
        owner.reset();
    });
    it.each([false, true])(
        'retains the actual frozen MIDI clock after a media await (incoming=%s)',
        async (incoming) => {
            compensation.seconds = 0.5;
            const frozen = seedTrack('left', 4, true, 0, true);
            frozen.freezeState.compensationSeconds = 0.5;
            const waiting = createTrack({ id: 'waiting', name: 'waiting', kind: 'midi', withoutDefaultDevice: true });
            waiting.devices = [
                { id: 'waiting-rack', name: 'waiting', type: 'yeast', bypassed: false, parameterValues: {} },
            ];
            waiting.clips = [{ ...frozen.clips[0]!, id: 'waiting-clip', type: 'midi' }];
            midiStoreState.value!.notesByClipId['waiting-clip'] = [
                { id: 'awaited', pitch: 72, startBeat: 0.1, duration: 0.05, velocity: 100, probability: 100 },
            ];
            trackStoreState.value = { tracks: [waiting, frozen] };
            buffers.delete('left-buffer');
            const input = {
                transport: {
                    ...defaultTransportState,
                    isPlaying: true,
                    tempo: 120,
                    isLooping: true,
                    loopStart: 0,
                    loopEnd: 4,
                },
                changes: [],
                position: incoming ? 3.9 : 0,
                audioTime: 10,
            };
            let bounded = true;
            let reads = 0;
            const owner = createLoopAudioSchedule({
                context: audioContextStub as unknown as BaseAudioContext,
                isCurrent: () => true,
                monotonicTime: () => (!bounded || ++reads === 1 ? 0 : 40),
            });
            expect(owner.refill(input).shortfall).toBe('time-budget');
            const pool = owner.poolAt(incoming ? 10.05 : 10, incoming)!;
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.mocked(processYeastMidi).mockImplementationOnce(async (block) => {
                await held;
                return [...block.events];
            });
            const watch = owner.watchFrozenMidiWindow(pool, 0, 0.2);
            const emission = watch(
                scheduleMidiNotes(
                    0,
                    0.2,
                    incoming ? -0.1 : 0,
                    pool.frozen,
                    pool.sources,
                    input.transport,
                    120,
                    undefined,
                    false,
                    undefined,
                    undefined,
                    10
                )
            );
            await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledOnce(), { interval: 1 });
            ctxTime.now = 10.01;
            buffers.set('left-buffer', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
            release();
            await emission;
            expect(scheduleNoteSpy.mock.calls.map((call) => call[2])).toEqual([72]);
            expect(frame(scheduleNoteSpy.mock.calls[0]![3])).toBe(incoming ? 508_800 : 506_400);
            const admitted = snapshotSources();
            const physicalStart = incoming ? 10.56 : 10.51;
            expect(admitted).toHaveLength(1);
            expect(admitted[0]!.start.when).toBe(physicalStart);
            expect(owner.coverage.through).toBe(10);
            bounded = false;
            ctxTime.now = 10.015;
            owner.refill({ ...input, position: incoming ? 3.93 : 0.03, audioTime: 10.015 });
            expect(snapshotSources().filter((source) => source.start.when === physicalStart)).toEqual(admitted);
            expect.soft(owner.coverage.shortfall).toBe('noncanonical-frozen-window');
            const before = snapshotSources();
            buffers.set('left-buffer', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
            ctxTime.now = 10.02;
            bounded = false;
            owner.refill({ ...input, position: incoming ? 3.94 : 0.04, audioTime: 10.02 });
            const after = snapshotSources();
            expect(after[0]!.stops.at(-1)?.when).toBe(10.02);
            const replacement = after.slice(before.length).find((source) => source.start.when === physicalStart);
            expect(replacement).toBeDefined();
            expect(replacement?.buffer).toBe(buffers.get('left-buffer'));
            expect(replacement?.start.offset).toBe(0);
            expect(effectiveEnd(replacement!)).toBeCloseTo(incoming ? 12.55 : 12.5, 12);
            expect(owner.coverage.from).toBe(10.02);
            expect(owner.coverage.through).toBeLessThanOrEqual(owner.coverage.completionAudioTime);
            expect(owner.coverage.shortfall).toBe('noncanonical-frozen-window');
            ctxTime.now = 13;
            owner.refill({ ...input, position: incoming ? 1.9 : 2, audioTime: 13 });
            expect(owner.coverage.shortfall).toBeNull();
            expect(owner.coverage.through).toBeGreaterThanOrEqual(owner.coverage.completionAudioTime + 0.35);
            owner.reset();
        }
    );
    it('keeps every admitted source after name-only changes', async () => {
        const track = await startShortLoop();
        const before = snapshotSources();
        track.name = 'renamed track';
        track.clips[0]!.name = 'renamed clip';
        await tickAt(1_200);
        expect(snapshotSources()).toEqual(before);
    });
    it('reconciles an actual envelope point change under an unchanged clip ID', async () => {
        envelopeState.value = {
            envelopes: {
                'left-clip': {
                    enabled: true,
                    points: [
                        { beatOffset: 0, gainDb: -6 },
                        { beatOffset: 0.25, gainDb: 0 },
                    ],
                },
            },
        };
        await startShortLoop();
        const before = snapshotSources();
        envelopeState.value.envelopes['left-clip']!.points[0]!.gainDb = -12;
        await tickAt(1_200);
        const after = snapshotSources();
        expect(frame(after[0]!.stops.at(-1)!.when)).toBe(ANCHOR_FRAME + 1_440);
        expect(after.slice(1, before.length).every((source) => source.stops.at(-1)!.when === 10.025)).toBe(true);
        const current = after.slice(before.length).find((source) => source.start.when === 10.025);
        expect(current?.start.offset).toBeCloseTo(0.4, 12);
        expect(effectiveEnd(current!)).toBe(10.125);
    });
    it('keeps muted cue-send material eligible until its actual destination disappears', async () => {
        const track = await startShortLoop();
        const bus = createTrack({ id: 'cue', kind: 'bus', name: 'cue', withoutDefaultDevice: true });
        track.sends = [{ busId: 'cue', preFader: true, level: 1 }];
        trackStoreState.value!.tracks.push(bus);
        track.muted = true;
        const before = snapshotSources();
        await tickAt(1_200);
        expect(snapshotSources()).toEqual(before);
        trackStoreState.value!.tracks.pop();
        await tickAt(2_400);
        expect(frame(snapshotSources()[0]!.stops.at(-1)!.when)).toBe(ANCHOR_FRAME + 2_640);
        expect(
            snapshotSources()
                .slice(1)
                .every((source) => source.stops.at(-1)!.when === 10.05)
        ).toBe(true);
    });
    it('cuts the last sounding track when the programme becomes empty', async () => {
        const track = await startShortLoop(true);
        track.muted = true;
        await tickAt(1_200);
        const sources = snapshotSources();
        expect(frame(sources[0]!.stops.at(-1)!.when)).toBe(ANCHOR_FRAME + 1_440);
        expect(sources.slice(1).every((source) => source.stops.at(-1)!.when === 10.025)).toBe(true);
        expect(sources).toHaveLength(3);
        expect(schedulerSession.loopAudioSchedule!.coverage.shortfall).toBeNull();
    });
    it.each([false, true])(
        'reconciles an older compensated pass whose source has not started (frozen=%s)',
        async (frozen) => {
            compensation.seconds = 0.5;
            const track = await startShortLoop(frozen);
            await tickAt(7_200);
            const before = snapshotSources();
            const old = before.find((source) => source.start.when === 10.5)!;
            expect(old.start.requestedAt).toBe(10);
            expect(before.filter((source) => source.start.when === 10.5)).toHaveLength(1);
            expect(effectiveEnd(old)).toBe(10.625);
            buffers.set('left-buffer', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
            track.clips[0]!.audioOffsetSeconds = 2;
            await tickAt(8_400);
            const after = snapshotSources();
            expect(after[0]!.stops.at(-1)?.when).toBe(10.175);
            const replacement = after.slice(before.length).find((source) => source.start.when === 10.5);
            expect(replacement).toBeDefined();
            expect(replacement?.buffer).toBe(buffers.get('left-buffer'));
            expect(replacement?.buffer).not.toBe(old.buffer);
            expect(replacement?.start.offset).toBe(frozen ? 0 : 2);
            expect(effectiveEnd(replacement!)).toBe(10.625);
        }
    );
    it('cancels a source started before a later gain submission fails, preserving completed sources', async () => {
        await startShortLoop();
        const before = snapshotSources();
        gainFailure.enabled = true;
        await tickAt(2_400, 'Fixture gain submission failed');
        sourceStartClockAdvance.armed = false;
        sourceStartClockAdvance.seconds = 0;
        sourceStartClockAdvance.invocations = 0;
        gainFailure.enabled = false;
        const after = snapshotSources();
        expect(after).toHaveLength(before.length + 1);
        expect(after.at(-1)?.stops.at(-1)?.when).toBe(10.05);
        expect(after.slice(0, before.length).map((source) => source.stops)).toEqual(
            before.map((source) => source.stops)
        );
        expect(schedulerSession.loopAudioSchedule!.coverage.through).toBe(10.375);
    });
    it.each([12_000, 12_001])(
        'reports the250ms protection boundary under a%s-frame interruption',
        async (stallFrames) => {
            await startShortLoop();
            await tickAt(5_952);
            const coverage = schedulerSession.loopAudioSchedule?.coverage;
            expect(coverage?.shortfall).toBeNull();
            expect(frame(coverage!.through) - ANCHOR_FRAME).toBe(22_752);
            // A250ms block retains exactly100ms of completed coverage. One frame
            // later retains4799frames; neither requested target nor recovery can
            // retrospectively extend this frozen completion witness.
            expect(frame(coverage!.through) - (ANCHOR_FRAME + 17_952)).toBe(4_800);
            expect(frame(coverage!.through) - (ANCHOR_FRAME + 17_953)).toBe(4_799);
            const submitted = snapshotSources();
            await tickAt(5_952 + stallFrames);
            expect(playheadWrapCountRef.current).toBe(2);
            expect(playheadClockRef.beat).toBeCloseTo(0.248 + (stallFrames - 12_000) / 24_000, 12);
            expect(frame(coverage!.through) - (ANCHOR_FRAME + 5_952 + stallFrames)).toBe(16_800 - stallFrames);
            const firstIncoming = snapshotSources().filter(
                (source) => frame(source.start.when) === ANCHOR_FRAME + 12_000
            );
            expect(firstIncoming).toHaveLength(1);
            expect(firstIncoming[0]?.start.requestedAt).toBe(10);
            expect(submitted.some((source) => source.start.when === firstIncoming[0]?.start.when)).toBe(true);
        }
    );
    it('recovers beyond actual coverage at the mapped current source phase', async () => {
        await startShortLoop();
        // The completed350ms window cannot promise this600ms interruption.
        const before = snapshotSources();
        expect(before.some((source) => frame(source.start.when) >= ANCHOR_FRAME + 24_000)).toBe(false);
        await tickAt(28_800);
        const joined = snapshotSources().filter((source) => frame(source.start.requestedAt) === ANCHOR_FRAME + 28_800);
        const current = joined.find((source) => frame(source.start.when) === ANCHOR_FRAME + 28_800);
        expect(frame(current!.start.offset)).toBe(18_000 + 4_800);
        expect(frame(effectiveEnd(current!))).toBe(ANCHOR_FRAME + 30_000);
        expect(playheadWrapCountRef.current).toBe(4);
    });
    it.each(['stop', 'dispose'] as const)('cancels a future source less than5ms away through %s', async (action) => {
        await startShortLoop(true);
        ctxTime.now = (ANCHOR_FRAME + 5_952) / SAMPLE_RATE;
        if (action === 'stop') {
            stopPlayheadScheduler();
        } else {
            disposePlayheadScheduler();
        }
        const future = snapshotSources().filter((source) => frame(source.start.when) > ANCHOR_FRAME + 5_952);
        expect(future).toHaveLength(2);
        expect(future.map((source) => frame(source.stops.at(-1)!.when))).toEqual([
            ANCHOR_FRAME + 5_952,
            ANCHOR_FRAME + 5_952,
        ]);
    });
    it.each(['pause', 'seek'] as const)(
        'retires queued sources through the actual %s route before a near start',
        async (action) => {
            await startShortLoop(true);
            const before = snapshotSources();
            ctxTime.now = 10.124;
            if (action === 'pause') {
                pausePlayback();
                await vi.waitFor(() => expect(schedulerSession.worker).toBeNull(), { interval: 1 });
                expect(transportStoreState.value?.isPlaying).toBe(false);
            } else {
                await executePlayheadSeek(0.1);
                expect(transportStoreState.value?.playheadPosition).toBe(0.1);
            }
            const retired = snapshotSources().slice(0, before.length);
            expect(retired.slice(1).map((source) => source.stops.at(-1)!.when)).toEqual([10.124, 10.124]);
            expect(loggedError).not.toHaveBeenCalled();
        }
    );
    it.each(['stop', 'play_next'] as const)(
        'retires old future passes through the real %s follow action',
        async (action) => {
            const track = await startShortLoop(false, 4);
            track.clips[0]!.endBeat = 0.09;
            track.clips[0]!.followAction = action;
            track.clips.push({
                ...track.clips[0]!,
                id: 'next',
                startBeat: 0.15,
                endBeat: 0.2,
                followAction: undefined,
            });
            await tickAt(1_200);
            const before = snapshotSources();
            schedulerSession.onStopRequested = () => {
                transportStoreState.value!.isPlaying = false;
                stopPlayheadScheduler();
            };
            await tickAt(2_400, undefined, action === 'stop');
            const after = snapshotSources();
            const oldFuture = after.slice(0, before.length).filter((source) => source.start.when > 10.05);
            expect(oldFuture.length).toBeGreaterThan(0);
            expect(oldFuture.every((source) => source.stops.at(-1)!.when === 10.05)).toBe(true);
            if (action === 'play_next') {
                expect(playheadClockRef.beat).toBe(0.15);
                expect(after.slice(before.length).some((source) => source.start.when === 10.05)).toBe(true);
            }
        }
    );
    it.each(['loop off', 'region', 'base tempo', 'map tempo'] as const)(
        'retires every queued old mapping on %s',
        async (edit) => {
            await startShortLoop(true);
            const before = snapshotSources();
            if (edit === 'loop off') {
                transportStoreState.value!.isLooping = false;
            }
            if (edit === 'region') {
                transportStoreState.value!.loopEnd = 0.5;
            }
            if (edit === 'base tempo') {
                transportStoreState.value!.tempo = 90;
            }
            if (edit === 'map tempo') {
                tempoMapStoreState.value = {
                    changes: [{ id: 'slower', beat: 0, tempo: 90, curve: 'instant' }],
                };
            }
            await tickAt(1_200);
            const after = snapshotSources();
            for (const [index, source] of before.entries()) {
                const retired = after[index]!;
                const sounding = source.start.when <= 10.025;
                expect(retired.stops.at(-1)!.when).toBeCloseTo(sounding ? 10.03 : 10.025, 12);
            }
            const next = after.slice(before.length);
            expect(next.length).toBeGreaterThan(0);
            expect(next.every((source) => source.start.requestedAt === 10.025)).toBe(true);
        }
    );
    it.each(['origin', 'compensation', 'unfreeze', 'refreeze'] as const)(
        'reconciles a frozen track after its %s changes',
        async (edit) => {
            const track = await startShortLoop(true);
            const before = snapshotSources();
            if (edit === 'origin') {
                track.clips[0]!.startBeat = 0.1;
            }
            if (edit === 'compensation') {
                track.freezeState.compensationSeconds = 0.02;
            }
            if (edit === 'unfreeze') {
                track.freezeState = { status: 'unfrozen' };
            }
            if (edit === 'refreeze') {
                buffers.set('refrozen', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
                track.freezeState = { status: 'frozen', frozenBufferId: 'refrozen', compensationSeconds: 0 };
            }
            await tickAt(1_200);
            const after = snapshotSources();
            for (const [index, source] of before.entries()) {
                expect(frame(after[index]!.stops.at(-1)!.when)).toBe(
                    ANCHOR_FRAME + (source.start.when <= 10.025 ? 1_440 : 1_200)
                );
            }
            const next = after.slice(before.length);
            expect(next.length).toBeGreaterThan(0);
            if (edit === 'refreeze') {
                expect(next.every((source) => source.bufferId === 'refrozen')).toBe(true);
            }
            if (edit === 'origin') {
                expect(next[0]!.start.when).toBeCloseTo(10.05, 12);
            }
            if (edit === 'compensation') {
                expect(next[1]!.start.when).toBeCloseTo(10.145, 12);
            }
        }
    );
    it('excludes a clip whose only head is exactly loopEnd', async () => {
        const track = await startShortLoop();
        const outside = {
            ...track.clips[0]!,
            id: 'outside',
            audioBufferId: 'outside-buffer',
            startBeat: 0.25,
            endBeat: 1,
        };
        buffers.set('outside-buffer', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
        track.clips.push(outside);
        await tickAt(1_200);
        expect(snapshotSources().some((source) => source.bufferId === 'outside-buffer')).toBe(false);
    });
    it('keeps live MIDI on its100ms window while buffers use350ms', async () => {
        const audio = seedTrack('left', 4, false, 0.375);
        const midi = createTrack({ id: 'live', kind: 'midi', name: 'live', withoutDefaultDevice: true });
        midi.clips = [{ ...audio.clips[0]!, id: 'live-clip', trackId: 'live', type: 'midi' }];
        trackStoreState.value = { tracks: [audio, midi] };
        midiStoreState.value!.notesByClipId['live-clip'] = [
            { id: 'head', pitch: 60, startBeat: 0, duration: 0.05, velocity: 100, probability: 100 },
            { id: 'future', pitch: 67, startBeat: 0.5, duration: 0.05, velocity: 100, probability: 100 },
        ];
        transportStoreState.value = {
            ...defaultTransportState,
            isPlaying: true,
            tempo: 120,
            isLooping: true,
            loopStart: 0,
            loopEnd: 4,
        };
        startPlayheadScheduler();
        await tickAt(0);
        expect(scheduleNoteSpy.mock.calls.map((call) => call[2])).toEqual([60]);
        expect(schedulerSession.loopAudioSchedule!.coverage.through).toBe(10.35);
        await tickAt(7_200);
        expect(scheduleNoteSpy.mock.calls.map((call) => call[2])).toEqual([60, 67]);
        expect(scheduleNoteSpy.mock.calls[1]![3]).toBeCloseTo(10.25, 12);
    });
    it.each([
        { label: 'without refill delay', looping: true, sourceStartBeat: 0.96, delay: 0, expectedTime: 10.225 },
        {
            label: 'with delay inside loop refill',
            looping: true,
            sourceStartBeat: 0.96,
            delay: 0.04,
            expectedTime: 10.225,
        },
        {
            label: 'with delay after MIDI in the legacy path',
            looping: false,
            sourceStartBeat: 0.45,
            delay: 0.04,
            expectedTime: 10.225,
        },
    ] as const)('binds normal MIDI and clicks to the tick clock $label', async (scenario) => {
        const audio = seedTrack('left', 4, false, 0.375);
        audio.clips[0]!.startBeat = scenario.sourceStartBeat;
        const midi = createTrack({ id: 'live', kind: 'midi', name: 'live', withoutDefaultDevice: true });
        midi.clips = [{ ...audio.clips[0]!, id: 'live-clip', trackId: 'live', type: 'midi', startBeat: 0 }];
        trackStoreState.value = { tracks: [audio, midi] };
        midiStoreState.value!.notesByClipId['live-clip'] = [
            { id: 'due', pitch: 60, startBeat: 0.45, duration: 0.05, velocity: 100, probability: 100 },
        ];
        transportStoreState.value = {
            ...defaultTransportState,
            isPlaying: true,
            tempo: 120,
            isLooping: scenario.looping,
            loopStart: 0,
            loopEnd: 4,
            metronomeEnabled: true,
            timeSignatureDenominator: 8,
        };
        startPlayheadScheduler();
        await tickAt(0);
        await tickAt(4_800);
        expect(scheduleNoteSpy).not.toHaveBeenCalled();
        expect(snapshotSources()).toHaveLength(0);

        sourceStartClockAdvance.armed = true;
        sourceStartClockAdvance.seconds = scenario.delay;
        await tickAt(7_200);

        expect(sourceStartClockAdvance.invocations).toBe(1);
        expect(scheduleNoteSpy.mock.calls.map((call) => call[2])).toEqual([60]);
        expect.soft(frame(scheduleNoteSpy.mock.calls[0]![3])).toBe(490_800);
        expect.soft(scheduleNoteSpy.mock.calls[0]![3]).toBeCloseTo(scenario.expectedTime, 12);
        expect.soft(scheduleClickSpy.mock.calls.map((call) => frame(call[0]))).toEqual([480_000, 492_000]);
        expect(playheadClockRef.audioTimeSeconds).toBe(10.15);
        expect(playheadClockRef.beat).toBeCloseTo(0.3, 12);
        expect(schedulerSession.lastScheduledBeat).toBeCloseTo(0.5, 12);
        expect(snapshotSources()).toHaveLength(1);
    });
    it.each([0, 0.04])(
        'binds dying and incoming MIDI and clicks to the tick clock with %ss preparation',
        async (delay) => {
            const audio = seedTrack('left', 4, false, 0.375);
            audio.clips[0]!.startBeat = 3.9;
            const midi = createTrack({ id: 'live', kind: 'midi', name: 'live', withoutDefaultDevice: true });
            midi.clips = [{ ...audio.clips[0]!, id: 'live-clip', trackId: 'live', type: 'midi', startBeat: 0 }];
            trackStoreState.value = { tracks: [audio, midi] };
            midiStoreState.value!.notesByClipId['live-clip'] = [
                { id: 'incoming', pitch: 60, startBeat: 0, duration: 0.05, velocity: 100, probability: 100 },
                { id: 'dying', pitch: 67, startBeat: 3.9, duration: 0.05, velocity: 100, probability: 100 },
            ];
            transportStoreState.value = {
                ...defaultTransportState,
                isPlaying: true,
                tempo: 120,
                isLooping: true,
                loopStart: 0,
                loopEnd: 4,
                metronomeEnabled: true,
                timeSignatureDenominator: 32,
            };
            startPlayheadScheduler();
            await tickAt(0);
            expect(scheduleNoteSpy.mock.calls.map((call) => call[2])).toEqual([60]);
            expect(snapshotSources()).toHaveLength(0);
            scheduleNoteSpy.mockClear();
            scheduleClickSpy.mockClear();
            sourceStartClockAdvance.armed = true;
            sourceStartClockAdvance.seconds = delay;
            await tickAt(92_400);
            expect(sourceStartClockAdvance.invocations).toBe(1);
            expect(scheduleNoteSpy.mock.calls.map((call) => call[2])).toEqual([67, 60]);
            // 3.9 and the incoming 0 land at 11.95 and 12 on the unchanged 120 BPM map.
            expect.soft(scheduleNoteSpy.mock.calls.map((call) => frame(call[3]))).toEqual([573_600, 576_000]);
            expect.soft(scheduleClickSpy.mock.calls.map((call) => frame(call[0]))).toEqual([573_000, 576_000]);
            expect(playheadClockRef.audioTimeSeconds).toBe(11.925);
            expect(schedulerSession.pendingSeam?.seamAudioTime).toBe(12);
            expect(schedulerSession.lastScheduledBeat).toBeCloseTo(0.05, 12);
        }
    );
    it('uses the integrated nonzero loop ramp for every pass anchor and source end', async () => {
        const track = seedTrack('left', 4.5, false, 0.375);
        track.clips[0]!.startBeat = 4;
        trackStoreState.value = { tracks: [track] };
        tempoMapStoreState.value = {
            changes: [
                { id: 'ramp', beat: 4, tempo: 120, curve: 'linear' },
                { id: 'end', beat: 4.5, tempo: 240, curve: 'instant' },
                { id: 'outside', beat: 4.5001, tempo: 20, curve: 'instant' },
            ],
        };
        transportStoreState.value = {
            ...defaultTransportState,
            isPlaying: true,
            tempo: 90,
            playheadPosition: 4,
            isLooping: true,
            loopStart: 4,
            loopEnd: 4.5,
        };
        startPlayheadScheduler();
        await tickAt(0);
        // Integral from4 to4.5 of60/(120+240*(b-4)) db.
        const passSeconds = Math.log(2) / 4;
        const submitted = snapshotSources();
        expect(submitted).toHaveLength(3);
        for (const [index, source] of submitted.entries()) {
            expect(source.start.when).toBeCloseTo(10 + index * passSeconds, 12);
            expect(source.start.offset).toBe(0.375);
            expect(effectiveEnd(source)).toBeCloseTo(10 + (index + 1) * passSeconds, 12);
        }
    });
    it('bounds a real-emitter tiny-loop refill and skips billions of uncaptured recording seams', async () => {
        const track = seedTrack('left', 4, false, 0.375);
        trackStoreState.value = { tracks: [track] };
        transportStoreState.value = {
            ...defaultTransportState,
            isPlaying: true,
            tempo: 120,
            isLooping: true,
            loopStart: 0,
            loopEnd: 2e-10,
        };
        startPlayheadScheduler();
        await tickAt(0);
        const first = schedulerSession.loopAudioSchedule!.coverage;
        expect(first).toMatchObject({ shortfall: 'pass-budget', windows: 64 });
        expect(snapshotSources()).toHaveLength(64);
        expect(first.through).toBeGreaterThan(10);
        expect(first.through).toBeLessThan(10.000001);
        await tickAt(48_000);
        expect(playheadWrapCountRef.current).toBeGreaterThan(999_999_999);
        expect(schedulerSession.loopAudioSchedule!.coverage.windows).toBeLessThanOrEqual(64);
        expect(snapshotSources().length).toBeLessThanOrEqual(128);
    });
    it.each(['stop', 'dispose'] as const)(
        'keeps arithmetic-shortfall legacy recovery owned by existing teardown (%s)',
        async (action) => {
            trackStoreState.value = { tracks: [seedTrack('left', 4, false, 0.375)] };
            transportStoreState.value = {
                ...defaultTransportState,
                isPlaying: true,
                tempo: 120,
                isLooping: true,
                loopStart: 0,
                loopEnd: 2e-20,
            };
            startPlayheadScheduler();
            await tickAt(0);
            expect(schedulerSession.loopAudioSchedule!.active).toBe(false);
            expect(schedulerSession.loopAudioSchedule!.coverage).toMatchObject({
                shortfall: 'unrepresentable',
                windows: 0,
                from: 10,
                through: 10,
            });
            expect(schedulerSession.activeAudioSources).toHaveLength(1);
            expect(snapshotSources()).toHaveLength(1);
            expect(snapshotSources()[0]!.start).toMatchObject({ when: 10, offset: 0.375, duration: 2 });
            ctxTime.now = 10.001;
            if (action === 'stop') {
                stopPlayheadScheduler();
            } else {
                disposePlayheadScheduler();
            }
            expect(schedulerSession.activeAudioSources).toEqual([]);
            expect(frame(effectiveEnd(snapshotSources()[0]!))).toBe(frame(10.006));
        }
    );
    it.each(['stop', 'dispose'] as const)(
        'returns to legacy recovery when an admitted pass index later becomes unsafe (%s)',
        async (action) => {
            expect(10 + 4e-15 * 0.5).toBeGreaterThan(10);
            trackStoreState.value = { tracks: [seedTrack('left', 4, false, 0.375)] };
            transportStoreState.value = {
                ...defaultTransportState,
                isPlaying: true,
                tempo: 120,
                isLooping: true,
                loopStart: 0,
                loopEnd: 4e-15,
            };
            startPlayheadScheduler();
            await tickAt(0);
            expect(schedulerSession.loopAudioSchedule!.active).toBe(true);
            expect(schedulerSession.loopAudioSchedule!.coverage).toMatchObject({
                windows: 64,
                shortfall: 'pass-budget',
            });
            expect(snapshotSources()).toHaveLength(64);
            await tickAt(90 * SAMPLE_RATE);
            expect(schedulerSession.loopAudioSchedule!.active).toBe(false);
            expect(schedulerSession.loopAudioSchedule!.coverage).toMatchObject({
                windows: 0,
                shortfall: 'unrepresentable',
                from: 100,
                through: 100,
            });
            const recovered = snapshotSources().filter((source) => source.start.requestedAt === 100);
            expect(recovered).toHaveLength(1);
            expect(recovered[0]!.start).toMatchObject({ when: 100, offset: 0.375, duration: 2 });
            expect(schedulerSession.activeAudioSources).toHaveLength(1);
            ctxTime.now = 100.001;
            if (action === 'stop') {
                stopPlayheadScheduler();
            } else {
                disposePlayheadScheduler();
            }
            expect(schedulerSession.activeAudioSources).toEqual([]);
            expect(frame(effectiveEnd(snapshotSources().at(-1)!))).toBe(frame(100.006));
        }
    );
    it.each(['gain', 'fade', 'entry', 'stretch', 'mute', 'remove', 'buffer', 'move'] as const)(
        'retires queued material after a %s edit while retaining an unrelated track',
        async (edit) => {
            const changed = await startShortLoop();
            const unchanged = seedTrack('right', 0.25, false, 1.125);
            trackStoreState.value!.tracks.push(unchanged);
            await tickAt(1_200);
            const before = snapshotSources();
            const unchangedCurrent = before.find(
                (source) => source.bufferId === 'right-buffer' && source.start.when === 10.025
            );
            const clip = changed.clips[0]!;
            if (edit === 'gain') {
                clip.gain = 0.5;
            }
            if (edit === 'fade') {
                clip.fadeInBeats = 0.1;
            }
            if (edit === 'entry') {
                clip.audioOffsetSeconds = 2;
            }
            if (edit === 'stretch') {
                clip.stretchRatio = 2;
                clip.stretchMode = 'repitch';
            }
            if (edit === 'mute') {
                changed.muted = true;
            }
            if (edit === 'remove') {
                trackStoreState.value!.tracks.splice(0, 1);
            }
            if (edit === 'buffer') {
                buffers.set('left-buffer', { duration: 16, sampleRate: SAMPLE_RATE } as AudioBuffer);
            }
            if (edit === 'move') {
                clip.startBeat = 0.125;
            }
            await tickAt(2_400);
            const after = snapshotSources();
            const oldFuture = after.filter(
                (source, index) =>
                    index < before.length && source.bufferId === 'left-buffer' && source.start.when > 10.05
            );
            expect(oldFuture.length).toBeGreaterThan(0);
            expect(oldFuture.every((source) => source.stops.at(-1)!.when <= source.start.when)).toBe(true);
            if (edit === 'buffer') {
                const replacement = after.find(
                    (source, index) =>
                        index >= before.length &&
                        source.bufferId === 'left-buffer' &&
                        frame(source.start.when) === ANCHOR_FRAME + 6_000
                );
                expect(replacement?.buffer).toBe(buffers.get('left-buffer'));
                expect(replacement?.buffer).not.toBe(oldFuture[0]?.buffer);
                expect(frame(replacement!.start.offset)).toBe(18_000);
                expect(frame(effectiveEnd(replacement!))).toBe(ANCHOR_FRAME + 12_000);
            }
            if (edit === 'stretch') {
                const stretched = after
                    .slice(before.length)
                    .find(
                        (source) =>
                            source.bufferId === 'left-buffer' && frame(source.start.when) === ANCHOR_FRAME + 6_000
                    );
                expect(stretched?.start.rate).toBe(2);
                expect(frame(stretched!.start.offset)).toBe(18_000);
                expect(frame(stretched!.start.duration!)).toBe(12_000);
                expect(frame(effectiveEnd(stretched!))).toBe(ANCHOR_FRAME + 12_000);
            }
            // The source already sounding on an unchanged track survives a
            // foreign clip's edit; future passes are rebuilt coherently.
            expect(unchangedCurrent).toBeDefined();
            const retained = after.find(
                (source) => source.start.when === unchangedCurrent!.start.when && source.bufferId === 'right-buffer'
            );
            expect(retained?.stops).toEqual(unchangedCurrent!.stops);
        }
    );
});
