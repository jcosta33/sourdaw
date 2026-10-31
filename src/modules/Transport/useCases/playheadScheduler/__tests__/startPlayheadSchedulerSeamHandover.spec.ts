import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * Seam handover coverage: the scheduled seam (#4656) emits two windows through
 * one tick — the dying pass's remainder and the incoming pass's opening — and
 * each of these tests pins one duty of the handover between them. Driven
 * through the REAL `scheduleMetronome`, `resetMetronomeBeat` and
 * `scheduleAudioClips` (the sibling specs mock the clip scheduler, so they can
 * only observe that scheduling was requested); `scheduleClick` and the frozen
 * track's `source.start` are the observation points.
 */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const midiStoreState: {
    value: { notesByClipId: Record<string, unknown[]>; probabilitySeed: number } | null;
} = { value: null };
const ctxTime = { now: 0 };

const audioContextStub = {
    sampleRate: 48000,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({
        connect: () => {},
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

vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRootIdentity: () => 'scheduler-fixture-root' }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRootIdentity: vi.fn<typeof import('#/modules/CrdtDocument/useCases').captureProjectRootIdentity>(
        () => 'root-identity'
    ),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    adjustmentLayerStore: { value: null },
    gainEnvelopeStore: { value: null },
    getTrackEligibility: vi.fn(),
    markerStore: { value: null },
    vcaGroupStore: { value: null },
    warpStateStore: { value: null },

    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: { value: { lanes: [] } },
    // The loop-wrap take path reads which clips are actively recording; no test
    // here records, so the ref stays empty.
    activeRecordingRef: { current: [] },
    // scheduleAudioClips reads the clip gain envelope per iteration; no fixture
    // here carries one, and the frozen-track path continues before the clip
    // loop anyway.
    getGainEnvelopeSeries: () => null,
    // Pulled in transitively: the scheduler reaches Levain's param bridge, whose
    // dependency bundle destructures these off this barrel at module scope. A
    // factory that omits them fails the whole file at import, not at a test.
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));
vi.mock('#/modules/Collaboration/stores', () => ({ collaborationStore: { value: null } }));
vi.mock('#/modules/Collaboration/useCases', () => ({ getAssetTransfer: () => null }));
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
type MeterChangeFixture = { id: string; beat: number; numerator: number; denominator: number };
const timeSignatureMapStoreState = vi.hoisted((): { value: { changes: MeterChangeFixture[] } } => ({
    value: { changes: [] },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return timeSignatureMapStoreState.value;
        },
    },
}));
vi.mock('#/modules/Toaster/stores', () => ({ toasterStore: { value: null } }));
vi.mock('#/modules/Automation/stores', () => ({
    modulationStore: { value: null },
    automationStore: { value: null },
}));

const applyModulationSpy = vi.hoisted(() => vi.fn<(beat: number) => void>());
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    applyModulation: applyModulationSpy,
    applyModulationToEngine: vi.fn(),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
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
    resolveClipsWithComping: (_trackId: string, clips: { startBeat: number; endBeat: number }[]) =>
        clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: clip.startBeat,
        })),
    getSynthParamsForTrack: () => ({}),
}));
/**
 * First observation point: every metronome click the engine is told to play,
 * at the audio-clock time it was told to play it.
 */
const scheduleClickSpy = vi.hoisted(() => vi.fn<(time: number, isAccent: boolean, volume: number) => void>());
/**
 * Marks the seam tick for the pending-window test: the seam branch is the only
 * thing that panics the yeast runtime in these fixtures.
 */
const panicYeastRuntimeSpy = vi.hoisted(() => vi.fn<() => Promise<void>>(() => Promise.resolve()));
/**
 * Second observation point: every buffer source the frozen-track path starts,
 * with the clock reading at which the scheduler made the call — the seam
 * handover's whole-buffer duty is decided by whether a start is future-anchored
 * or an immediate mid-buffer restart.
 */
type RecordedSourceStart = { at: number; args: unknown[]; requestedAt: number };
const recordedSourceStarts = vi.hoisted(() => [] as RecordedSourceStart[]);
/**
 * Third observation point: every `stop` the fence (or any teardown) puts on a
 * scheduled source, with the clock reading at which it was asked. The seam
 * fence's whole contract is the instant it stops at.
 */
type RecordedSourceStop = { at: number; requestedAt: number };
const recordedSourceStops = vi.hoisted(() => [] as RecordedSourceStop[]);
vi.mock('#/modules/AudioEngine/useCases', () => ({
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
    createBufferSource: () => ({
        buffer: null,
        connect: () => {},
        playbackRate: { value: 1 },
        start: (...args: unknown[]) => {
            recordedSourceStarts.push({ at: args[0] as number, args, requestedAt: ctxTime.now });
        },
        stop: (...args: unknown[]) => {
            recordedSourceStops.push({ at: args[0] as number, requestedAt: ctxTime.now });
        },
        onended: null,
    }),
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => (bufferId === 'frozen-buf' ? { duration: 8 } : null),
    getFactoryDrumKitByIndex: vi.fn(),
    // No native engine here: the cursor these seams are about follows the
    // scheduler's own integration.
    readNativeEnginePlayheadSeconds: (): number | null => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
const scheduleNoteSpy = vi.hoisted(() =>
    vi.fn<(ctx: unknown, destination: unknown, pitch: number, startTime: number, ...rest: unknown[]) => unknown>()
);
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: () => null,
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: scheduleNoteSpy,
    getSynthParamsFromDevices: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ isFaustInstrumentModule: () => false }));
vi.mock('#/modules/Yeast/useCases', () => ({
    hydrateYeastCrdtProjection: vi.fn(),

    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
// scheduleAudioClips runs for real here: the handover under test is decided by
// which window repopulates its dedup keys, which is invisible through a mock.
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: panicYeastRuntimeSpy }));
vi.mock('../../../repositories/transport/updateTransportState', () => ({ updateTransportState: vi.fn() }));

const evaluateFollowActionsMock = vi.fn<
    (tracks: unknown[], from: number, to: number) => { jumpToPosition: number | null; shouldStop: boolean }
>(() => ({ jumpToPosition: null, shouldStop: false }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: (...args: unknown[]) => (evaluateFollowActionsMock as (...a: unknown[]) => unknown)(...args),
}));

const TEMPO_BPM = 120;
const BEATS_PER_SECOND = TEMPO_BPM / 60;
/**
 * 0.07 s per tick — deliberately not a divisor of the 2 s loop, so the wrap
 * overshoot is non-zero on every pass. A tick length that divides the loop
 * exactly lands `newPosition` on `loopEnd` and hides the defect behind a zero
 * overshoot.
 */
const TICK_SECONDS = 0.07;
const LOOP_BEATS = 4;
const LOOP_SECONDS = LOOP_BEATS / BEATS_PER_SECOND;

function frozenAudioTrack(): unknown {
    return {
        id: 'frozen-1',
        kind: 'audio',
        muted: false,
        armed: false,
        sends: [],
        clips: [{ id: 'frozen-clip', startBeat: 0, endBeat: LOOP_BEATS }],
        freezeState: { status: 'frozen', frozenBufferId: 'frozen-buf', compensationSeconds: 0 },
    };
}

function playingState(overrides: Partial<typeof defaultTransportState> = {}): typeof defaultTransportState {
    return { ...defaultTransportState, isPlaying: true, tempo: TEMPO_BPM, playheadPosition: 0, ...overrides };
}

type SchedulerWorkerHarness = { onmessage: ((event: { data: unknown }) => void) | null };

let schedulerTickSequence = 0;

function emitSchedulerTick(worker: SchedulerWorkerHarness): void {
    schedulerTickSequence++;
    const receivedAtMs = performance.timeOrigin + performance.now();
    worker.onmessage?.({
        data: {
            type: 'tick',
            generation: schedulerSession.generation,
            sequence: schedulerTickSequence,
            scheduledAtMs: receivedAtMs - 2,
            sentAtMs: receivedAtMs - 1,
        },
    });
}

async function runTick(worker: SchedulerWorkerHarness, tickSeconds = TICK_SECONDS): Promise<void> {
    ctxTime.now += tickSeconds;
    emitSchedulerTick(worker);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function schedulerWorker(): SchedulerWorkerHarness {
    return schedulerSession.worker as unknown as SchedulerWorkerHarness;
}

async function runUntilWraps(worker: SchedulerWorkerHarness, wrapsWanted: number): Promise<void> {
    let wraps = 0;
    let previousPosition = schedulerSession.accumulatedPosition;
    let ticks = 0;
    while (wraps < wrapsWanted && ticks < 500) {
        ticks++;
        await runTick(worker);
        if (schedulerSession.accumulatedPosition < previousPosition) {
            wraps++;
        }
        previousPosition = schedulerSession.accumulatedPosition;
    }
    expect(wraps).toBe(wrapsWanted);
}

describe('startPlayheadScheduler seam handover', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        recordedSourceStarts.length = 0;
        recordedSourceStops.length = 0;
        evaluateFollowActionsMock.mockImplementation(() => ({ jumpToPosition: null, shouldStop: false }));
        tempoMapStoreState.value = { changes: [] };
        timeSignatureMapStoreState.value = { changes: [] };
        midiStoreState.value = { notesByClipId: {}, probabilitySeed: 1 };
        trackStoreState.value = { tracks: [] };
        // Module-global metronome dedup state; carried between tests otherwise.
        metronomeSchedulingState.lastBeat = -1;
        metronomeSchedulingState.firedClickTimes.clear();
        ctxTime.now = 0;
        schedulerTickSequence = 0;
        disposePlayheadScheduler();
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: { data: unknown }) => void) | null = null;
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

    it('clicks every metrical beat of both loop passes across the seam', async () => {
        // The dying pass's window lifts `lastBeat` to its last beat before
        // loopEnd; the incoming window's clicks are gated on `lastBeat`, so one
        // window inheriting the other's high-water mark silences the metronome
        // for good. After the seam, every half-second grid instant must carry
        // exactly one click. The seam instant's click is the incoming pass's
        // loopStart beat, not the dying pass's loopEnd beat: here both are bar
        // lines, so this case cannot tell them apart — the cases below can.
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
            metronomeEnabled: true,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();
        await runUntilWraps(worker, 2);

        const clickTimes = scheduleClickSpy.mock.calls.map(([time]) => time).sort((left, right) => left - right);
        expect(clickTimes.length).toBeGreaterThan(0);
        // Loop [0,4) at 120 BPM: beats land on every half second. Two passes
        // plus the seam downbeat they share = beats 0 .. 8 inclusive.
        for (let beat = 0; beat <= 2 * LOOP_BEATS; beat++) {
            const instant = beat / BEATS_PER_SECOND;
            const atInstant = clickTimes.filter((time) => Math.abs(time - instant) <= 1e-3);
            expect(atInstant, `click at beat ${beat} (t=${instant}s)`).toHaveLength(1);
        }
    });

    it('publishes the dying pass through the pending-seam window instead of loopStart', async () => {
        // While the scheduled seam is still ahead of the clock, the AUDIBLE
        // transport is the dying pass's tail just below loopEnd — but the
        // published clock parked at loopStart for that window, so every
        // automation and modulation consumer read the loop-start value up to
        // one look-ahead early on every pass.
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();

        // A 10 ms grain keeps several ticks inside the pending window — the
        // configuration the defect is sized against (0.07 s ticks can jump the
        // whole window in one step). The first yeast panic marks the seam tick.
        let ticks = 0;
        while (panicYeastRuntimeSpy.mock.calls.length === 0 && ticks < 2000) {
            ticks++;
            await runTick(worker, 0.01);
        }
        expect(panicYeastRuntimeSpy).toHaveBeenCalled();

        // Every published value across the whole run stays on the dying pass's
        // valid positive phase: never the incoming pass's negative phase, never
        // past loopEnd. This is the constraint the park existed to keep.
        const publishedBeats = applyModulationSpy.mock.calls.map(([beat]) => beat);
        expect(publishedBeats.length).toBeGreaterThan(0);
        for (const beat of publishedBeats) {
            expect(beat).toBeGreaterThanOrEqual(0);
            expect(beat).toBeLessThanOrEqual(LOOP_BEATS);
        }

        // The tick after the seam tick: the seam instant is still ahead of the
        // clock, and the published clock must carry the dying pass's CONTINUED
        // position — strictly past loopStart, not parked on it.
        await runTick(worker, 0.01);
        const pendingBeat = applyModulationSpy.mock.calls[applyModulationSpy.mock.calls.length - 1]![0];
        expect(pendingBeat).toBeGreaterThan(0);
        expect(pendingBeat).toBeLessThanOrEqual(LOOP_BEATS);
        expect(playheadClockRef.beat).toBe(pendingBeat);
    });

    it('re-anchors the frozen track once per pass at the seam instant, never mid-buffer', async () => {
        // The seam's dedup clears used to precede the dying window's emission,
        // so the dying window re-scheduled the frozen buffer at the dying
        // position — an immediate `source.start(now, elapsed)` layered over its
        // own fenced source — and the re-added key blocked the incoming window
        // from re-anchoring it, leaving the duplicate playing post-loop content
        // through the whole next pass.
        trackStoreState.value = { tracks: [frozenAudioTrack()] };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();
        await runUntilWraps(worker, 2);

        // One start per pass: the session's initial anchor plus one per seam.
        expect(recordedSourceStarts).toHaveLength(3);
        // The session's initial anchor is exempt — playback opens one grain
        // into the first pass, so its resume is legitimately mid-buffer. Every
        // seam handover start must be a whole-buffer future start: the
        // incoming pass's own anchor, due at the seam instant.
        for (const start of recordedSourceStarts.slice(1)) {
            expect(start.args, `source start made at t=${start.requestedAt}`).toHaveLength(1);
            expect(start.at).toBeGreaterThanOrEqual(start.requestedAt);
        }
        // And those future starts land on the seam instants themselves, one
        // loop length apart.
        expect(recordedSourceStarts[1]!.at).toBeCloseTo(LOOP_SECONDS, 3);
        expect(recordedSourceStarts[2]!.at).toBeCloseTo(2 * LOOP_SECONDS, 3);
    });

    it('fences the sounding sources exactly at the seam instant, stopping nothing else early', async () => {
        // The seam fence cuts the sources that must not sound past the seam AT
        // the seam instant. Degenerating the fence to an immediate stop (the
        // teardown semantic: one 5 ms ramp after the current clock) keeps every
        // start green — the starts are future-anchored either way — so the
        // instant itself is the pinned observable.
        trackStoreState.value = { tracks: [frozenAudioTrack()] };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();
        await runUntilWraps(worker, 2);

        // Exactly one fence per seam — nothing else stops a scheduled source in
        // a steady looping session — and each stop lands on the seam instant
        // itself, not one grain after the clock.
        expect(recordedSourceStops).toHaveLength(2);
        expect(recordedSourceStops[0]!.at).toBeCloseTo(LOOP_SECONDS, 3);
        expect(recordedSourceStops[1]!.at).toBeCloseTo(2 * LOOP_SECONDS, 3);
    });

    type ExpectedClick = { time: number; accent: boolean };

    /**
     * Every click a looping session schedules up to (and including) the
     * instant two passes after it starts, sorted by time.
     */
    async function clicksOverTwoPasses(loopStart: number, loopEnd: number): Promise<ExpectedClick[]> {
        transportStoreState.value = playingState({
            playheadPosition: loopStart,
            isLooping: true,
            loopStart,
            loopEnd,
            metronomeEnabled: true,
            metronomeVolume: 0.37,
        });

        startPlayheadScheduler();
        await runUntilWraps(schedulerWorker(), 2);

        const twoPassesSeconds = (2 * (loopEnd - loopStart)) / BEATS_PER_SECOND;
        for (const [, , volume] of scheduleClickSpy.mock.calls) {
            expect(volume).toBe(0.37);
        }
        const clicks = scheduleClickSpy.mock.calls.map(([time, accent]) => ({ time, accent }));
        const twoPassClicks = clicks.filter(({ time }) => time <= twoPassesSeconds + 1e-3);
        return twoPassClicks.sort((left, right) => left.time - right.time);
    }

    /** The clicks each pass of `[loopStart, loopEnd)` owes, for passes 0, 1 and the opening of 2. */
    function expectedClicks(
        loopStart: number,
        loopEnd: number,
        passBeats: readonly { beat: number; accent: boolean }[]
    ): ExpectedClick[] {
        const passSeconds = (loopEnd - loopStart) / BEATS_PER_SECOND;
        const clicks: ExpectedClick[] = [];
        for (let pass = 0; pass <= 2; pass++) {
            for (const { beat, accent } of passBeats) {
                const time = pass * passSeconds + (beat - loopStart) / BEATS_PER_SECOND;
                if (time <= 2 * passSeconds + 1e-3) {
                    clicks.push({ time, accent });
                }
            }
        }
        return clicks;
    }

    function expectClicks(actual: ExpectedClick[], expected: ExpectedClick[]): void {
        expect(actual.map(({ accent }) => accent)).toEqual(expected.map(({ accent }) => accent));
        for (const [index, { time }] of actual.entries()) {
            expect(time, `click ${index}`).toBeCloseTo(expected[index]!.time, 6);
        }
    }

    // 4/4 from the origin, 3/4 from beat 5.5: bar lines at 0, 4 and 5.5.
    const meterChangeAtFiveAndAHalf: MeterChangeFixture = { id: 'three-four', beat: 5.5, numerator: 3, denominator: 4 };
    const beatsOneToFive = [
        { beat: 1, accent: false },
        { beat: 2, accent: false },
        { beat: 3, accent: false },
        { beat: 4, accent: true },
        { beat: 5, accent: false },
    ];

    it('leaves the seam silent when an off-grid loopStart follows a meter-change loopEnd', async () => {
        // Loop [0.5, 5.5): loopEnd is the 3/4 bar line, but the incoming pass
        // opens at 0.5, which is no beat at all. The dying pass used to click
        // its accented 5.5 at the seam instant on every wrap.
        timeSignatureMapStoreState.value = { changes: [meterChangeAtFiveAndAHalf] };

        const clicks = await clicksOverTwoPasses(0.5, 5.5);

        expectClicks(clicks, expectedClicks(0.5, 5.5, beatsOneToFive));
        for (const seamSeconds of [2.5, 5]) {
            expect(clicks.filter(({ time }) => Math.abs(time - seamSeconds) <= 1e-3)).toHaveLength(0);
        }
    });

    it('gives the seam click the incoming beat when a meter-change loopEnd meets an on-grid loopStart', async () => {
        // Loop [1, 5.5): the seam instant is both the dying pass's accented 5.5
        // and the incoming pass's unaccented beat 1. It must click once, as
        // beat 1.
        timeSignatureMapStoreState.value = { changes: [meterChangeAtFiveAndAHalf] };

        const clicks = await clicksOverTwoPasses(1, 5.5);

        expectClicks(clicks, expectedClicks(1, 5.5, beatsOneToFive));
        for (const seamSeconds of [2.25, 4.5]) {
            expect(clicks.filter(({ time }) => Math.abs(time - seamSeconds) <= 1e-3)).toEqual([
                { time: expect.closeTo(seamSeconds, 6), accent: false },
            ]);
        }
    });

    const beatsOneToThree = [
        { beat: 1, accent: false },
        { beat: 2, accent: false },
        { beat: 3, accent: false },
    ];

    it('leaves the seam silent when an off-grid loopStart follows a bar-line loopEnd', async () => {
        const clicks = await clicksOverTwoPasses(0.5, 4);

        expectClicks(clicks, expectedClicks(0.5, 4, beatsOneToThree));
        for (const seamSeconds of [1.75, 3.5]) {
            expect(clicks.filter(({ time }) => Math.abs(time - seamSeconds) <= 1e-3)).toHaveLength(0);
        }
    });

    it('gives the seam click the incoming beat when a bar-line loopEnd meets an on-grid loopStart', async () => {
        const clicks = await clicksOverTwoPasses(1, 4);

        expectClicks(clicks, expectedClicks(1, 4, beatsOneToThree));
        for (const seamSeconds of [1.5, 3]) {
            expect(clicks.filter(({ time }) => Math.abs(time - seamSeconds) <= 1e-3)).toEqual([
                { time: expect.closeTo(seamSeconds, 6), accent: false },
            ]);
        }
    });
});
