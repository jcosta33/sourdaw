import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { notePanicParticipants } from '../../transportControls/notePanicParticipants';
import { defaultTransportState } from '../../../models/TransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * #6277: a recovered playhead does not prove that the buffer at a missed seam
 * existed before the main thread stalled. These cases keep the real scheduler,
 * audio/frozen emitters, source-time projection and MIDI window dispatcher.
 * The browser source ledger proves submitted playback intervals, not PCM.
 */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: ReturnType<typeof createTrack>[] } | null } = { value: { tracks: [] } };
const midiStoreState: {
    value: {
        notesByClipId: Record<string, unknown[]>;
        ccByClipId: Record<string, unknown[]>;
        pitchBendByClipId: Record<string, unknown[]>;
        probabilitySeed: number;
    } | null;
} = { value: null };
const ctxTime = { now: 0 };

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
            setValueAtTime: () => {},
            linearRampToValueAtTime: () => {},
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
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRootIdentity: vi.fn<typeof import('#/modules/CrdtDocument/useCases').captureProjectRootIdentity>(
        () => 'root-identity'
    ),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    appendClipToTrack: vi.fn<typeof import('#/modules/Arrangement/stores').appendClipToTrack>(),
    clipSelectionStore: { value: null },
    resolveEligibleClipWriteTarget: vi.fn<typeof import('#/modules/Arrangement/stores').resolveEligibleClipWriteTarget>(
        () => ({ status: 'ineligible' })
    ),
    updateClipInStore: vi.fn(() => false),
    adjustmentLayerStore: { value: null },
    gainEnvelopeStore: { value: null },
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
    getGainEnvelopeSeries: () => null,
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
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
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
type SourceLedger = { bufferId: string; start: Start | null; stops: Stop[]; bufferDuration: number };
type SourceSnapshot = Omit<SourceLedger, 'stops' | 'start'> & { start: Start; stops: Stop[] };
const sourceLedger = vi.hoisted(() => [] as SourceLedger[]);
const buffers = vi.hoisted(() => new Map<string, AudioBuffer>());
const scheduleClickSpy = vi.hoisted(() => vi.fn());
const scheduleNoteSpy = vi.hoisted(() => vi.fn());

function createSource() {
    const ledger: SourceLedger = { bufferId: '', start: null, stops: [], bufferDuration: 0 };
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
            ledger.start = { when, offset, duration, rate: source.playbackRate.value, requestedAt: ctxTime.now };
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

vi.mock('#/modules/AudioEngine/useCases', () => ({
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
    getCompensationDelay: () => 0,
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
    audioEngine: { setTransportInfo: vi.fn() },
    stopAllScheduled: vi.fn(),
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
vi.mock('#/modules/PluginHost/useCases', () => ({ isFaustInstrumentModule: () => false }));
vi.mock('#/modules/Yeast/useCases', () => ({
    hydrateYeastCrdtProjection: vi.fn(),
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));

const settleGeneratedNotes = async () => {};
const SAMPLE_RATE = 48_000;
const ANCHOR_FRAME = 480_000;
const STALL_FRAMES = 9_600;
const TICK_FRAMES = 1_200;

type SchedulerWorkerHarness = { onmessage: ((event: { data: unknown }) => void) | null };
let workerHarness: SchedulerWorkerHarness | null = null;
let tickSequence = 0;

function snapshotSources(): SourceSnapshot[] {
    return sourceLedger.flatMap((source) =>
        source.start
            ? [{ ...source, start: { ...source.start }, stops: source.stops.map((stop) => ({ ...stop })) }]
            : []
    );
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

async function tickAt(relativeFrame: number): Promise<void> {
    ctxTime.now = (ANCHOR_FRAME + relativeFrame) / SAMPLE_RATE;
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
    expect(schedulerSession.tickInFlight).toBe(true);
    await vi.waitFor(
        () => {
            expect(schedulerSession.tickInFlight).toBe(false);
            expect(playheadClockRef.audioTimeSeconds).toBe(ctxTime.now);
            expect(loggedError).not.toHaveBeenCalled();
        },
        { interval: 1 }
    );
}

function seedTrack(id: string, loopEnd: number, frozen: boolean, sourceEntry: number) {
    const track = createTrack({ id, name: id, kind: 'audio', withoutDefaultDevice: true });
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

async function reproduceSeamStall(passFrames: number, lastRefillFrame: number, frozen: boolean): Promise<void> {
    const loopEnd = passFrames / 24_000; // Fixed fixture:120BPM means24000frames per quarter-note beat.
    trackStoreState.value = {
        tracks: [seedTrack('left', loopEnd, frozen, 0.375), seedTrack('right', loopEnd, frozen, 1.125)],
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

    await tickAt(recoveryFrame);
    expect(playheadWrapCountRef.current).toBe(crossedSeams);
    expect(playheadClockRef.beat).toBeCloseTo((recoveryFrame % passFrames) / 24_000, 12);
    const afterRecovery = snapshotSources();
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

beforeEach(() => {
    vi.clearAllMocks();
    disposePlayheadScheduler();
    sourceLedger.length = 0;
    buffers.clear();
    ctxTime.now = ANCHOR_FRAME / SAMPLE_RATE;
    tickSequence = 0;
    workerHarness = null;
    tempoMapStoreState.value = { changes: [] };
    trackStoreState.value = { tracks: [] };
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
                workerHarness = this;
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
});
