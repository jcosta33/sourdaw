import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { startRecording, stopRecording } from '#/modules/Arrangement/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * Seam and late-wrap punch coverage for the playhead scheduler, driven through
 * the REAL `scheduleMidiNotes` (the sibling `startPlayheadScheduler.spec.ts`
 * mocks it, so it can only observe that scheduling was requested, never what
 * came out). Everything below the note dispatch is stubbed, so `scheduleNote`
 * is the observation point: every assertion here is about a note the engine was
 * actually told to play, at the audio-clock time it was told to play it.
 */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const midiStoreState: {
    value: { notesByClipId: Record<string, unknown[]>; probabilitySeed: number } | null;
} = { value: null };
const ctxTime = { now: 0 };
/**
 * Audio-clock instants of the punch state machine's open and close calls, so a
 * test can assert the capture span between them — the same-tick empty-take
 * defect shows up as a zero span, not as a missing call.
 */
const punchClock = {
    start: [] as number[],
    stop: [] as number[],
};

const audioContextStub = {
    sampleRate: 48000,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({ connect: () => {} }),
};

const trackStripStub = {
    gainNode: {},
    deviceNodes: [] as unknown[],
    preFaderTap: { connect: () => {} },
};

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: { value: { lanes: [] } },
    // The loop-wrap take path reads which clips are actively recording; no test
    // here records, so the ref stays empty.
    activeRecordingRef: { current: [] },
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
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/Toaster/stores', () => ({ toasterStore: { value: null } }));
vi.mock('#/modules/Automation/stores', () => ({ automationStore: { value: null } }));
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
/**
 * Punch observation points: the punch state machine opens through
 * `startRecording` and closes through `stopRecording`; both are mocked at the
 * barrel the scheduler calls through and read through `vi.mocked` below.
 */
vi.mock('#/modules/Arrangement/useCases', () => ({
    discardRecording: vi.fn(),
    startRecording: vi.fn(() => {
        punchClock.start.push(ctxTime.now);
        return [] as { trackId: string; id: string }[];
    }),
    stopRecording: vi.fn(() => {
        punchClock.stop.push(ctxTime.now);
    }),
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
const scheduleClickSpy = vi.hoisted(() => vi.fn<(time: number, isAccent: boolean, volume: number) => void>());
vi.mock('#/modules/AudioEngine/useCases', () => ({
    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    getAudioContext: () => audioContextStub,
    getCurrentTime: () => ctxTime.now,
    scheduleClick: scheduleClickSpy,
    getCompensationDelay: () => 0,
    getDefaultBendRangeSemitones: () => 48,
    getDrumKitByIndex: () => null,
    ensureTrackStrip: () => trackStripStub,
    applyNoteExpression: vi.fn(),
    registerScheduledSource: vi.fn(),
    scheduleFaustNote: vi.fn(),
    audioEngine: { setTransportInfo: vi.fn() },
    stopAllScheduled: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    createBufferSource: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
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
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
// scheduleMetronome and resetMetronomeBeat run for real: the seam anchor is
// their window boundary too, and the click dedup they rely on is exactly the
// thing a wider window can defeat.
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../repositories/transport/updateTransportState', () => ({ updateTransportState: vi.fn() }));

const evaluateFollowActionsMock = vi.fn<
    (tracks: unknown[], from: number, to: number) => { jumpToPosition: number | null; shouldStop: boolean }
>(() => ({ jumpToPosition: null, shouldStop: false }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: (...args: unknown[]) => (evaluateFollowActionsMock as (...a: unknown[]) => unknown)(...args),
}));

const TEMPO_BPM = 120;
/**
 * 0.07 s per tick — deliberately not a divisor of the 2 s loop, so the wrap
 * overshoot is non-zero on every pass. A tick length that divides the loop
 * exactly lands `newPosition` on `loopEnd` and hides the defect behind a zero
 * overshoot.
 */
const TICK_SECONDS = 0.07;
const LOOP_BEATS = 4;
const PASSES = 3;
const PUNCH_IN_BEAT = 3.5;
const PUNCH_OUT_BEAT = 3.9;
/**
 * A punch region whose IN crossing lands exactly on the first scheduled-seam
 * tick. The scan strides 0.14 beats per tick (0.07 s at 120 BPM), so the scan
 * reads 3.78 on the tick before the seam tick and 3.92 on the seam tick itself
 * — the first tick whose scan sits inside [3.85, 3.95) is the seam tick.
 */
const PUNCH_IN_ON_SEAM_BEAT = 3.85;
const PUNCH_OUT_ON_SEAM_BEAT = 3.95;

function armedAudioTrack(): unknown {
    return { id: 'rec-1', armed: true, kind: 'audio', inputId: 'dev-punch', clips: [] };
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

async function runTick(worker: SchedulerWorkerHarness): Promise<void> {
    ctxTime.now += TICK_SECONDS;
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

function resetPunchHarness(): void {
    vi.clearAllMocks();
    evaluateFollowActionsMock.mockImplementation(() => ({ jumpToPosition: null, shouldStop: false }));
    tempoMapStoreState.value = { changes: [] };
    midiStoreState.value = null;
    // Module-global metronome dedup state; carried between tests otherwise.
    metronomeSchedulingState.lastBeat = -1;
    metronomeSchedulingState.firedClickTimes.clear();
    punchClock.start.length = 0;
    punchClock.stop.length = 0;
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
}

describe('startPlayheadScheduler punch across the loop seam', () => {
    beforeEach(() => {
        resetPunchHarness();
    });

    afterEach(() => {
        disposePlayheadScheduler();
        vi.unstubAllGlobals();
    });

    // The punch region's tail sits inside the dying pass's last look-ahead band:
    // the seam tick replaces the position with the incoming pass's negative
    // phase BEFORE the punch checks run, and no later tick ever revisits the
    // dying band. Punch-out therefore never fired while looping — the recording
    // ran unbounded across every wrap. Each pass must punch in AND punch out.
    it('finalizes the punch recording on every pass when the region ends inside the seam band', async () => {
        trackStoreState.value = { tracks: [armedAudioTrack()] };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
            punchInEnabled: true,
            punchInBeat: PUNCH_IN_BEAT,
            punchOutBeat: PUNCH_OUT_BEAT,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();
        await runUntilWraps(worker, PASSES);
        // Let the last seam tick's scheduling work settle.
        await runTick(worker);

        // One punch-in and one punch-out per pass: the state machine must reset
        // every pass, or the next pass's punch-in is swallowed by the stale
        // active flag. Both use cases take the beat optionally, so a recorded
        // call may carry no beat — such a call is not a punch boundary and is
        // filtered out explicitly.
        const punchIns = vi
            .mocked(startRecording)
            .mock.calls.filter(
                ([anchorBeat]) => anchorBeat !== undefined && Math.abs(anchorBeat - PUNCH_IN_BEAT) < 1e-6
            );
        expect(punchIns).toHaveLength(PASSES);
        const punchOuts = vi
            .mocked(stopRecording)
            .mock.calls.filter(([atBeat]) => atBeat !== undefined && Math.abs(atBeat - PUNCH_OUT_BEAT) < 1e-6);
        expect(punchOuts).toHaveLength(PASSES);
        // The recording is closed for good: no unbounded punch left running.
        expect(schedulerSession.punchRecordingActive).toBe(false);
    });

    // The punch-in crossing lands ON the seam tick itself: the punch-in gate
    // scans the dying pass's position, which first sits inside the region on
    // that very tick, so the recording opens on the seam tick. The seam-tick
    // punch-out shortcut (`punchOutDueAtSeam`) only asked whether a seam exists
    // and the punch-out beat sits inside the dying band — always true — so the
    // same tick that opened the recording also finalized it: an empty take, and
    // the exact failure the punch-in gate's upper bound names for the non-seam
    // path. The shortcut must only be due for a recording that was already open
    // when the tick began; a punch-in opened on the seam tick captures across
    // the seam and finalizes on a later scan crossing — here the next pass's
    // seam tick, giving a real capture span of one pass instead of zero.
    it('does not finalize the recording in the same tick its punch-in opened on the seam tick', async () => {
        trackStoreState.value = { tracks: [armedAudioTrack()] };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
            punchInEnabled: true,
            punchInBeat: PUNCH_IN_ON_SEAM_BEAT,
            punchOutBeat: PUNCH_OUT_ON_SEAM_BEAT,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();

        // Pass 1's seam tick: the scan crosses into the region and the punch-in
        // opens there, anchored at the region start.
        await runUntilWraps(worker, 1);
        const punchIns = vi
            .mocked(startRecording)
            .mock.calls.filter(
                ([anchorBeat]) => anchorBeat !== undefined && Math.abs(anchorBeat - PUNCH_IN_ON_SEAM_BEAT) < 1e-6
            );
        expect(punchIns).toHaveLength(1);
        expect(punchClock.start).toHaveLength(1);
        expect(punchClock.start[0]).toBeCloseTo(TICK_SECONDS * 28, 3);
        // The recording is still open: the seam-tick punch-out shortcut must not
        // swallow the take it just opened. On the unfixed head this is already
        // length 1 — the same tick's empty finalization.
        expect(punchClock.stop).toHaveLength(0);

        // Pass 2 runs out: the punch-out crossing of the dying band is behind
        // the seam now, so the recording captures across the wrap and finalizes
        // on pass 2's own seam tick — a real span, one full pass long.
        await runUntilWraps(worker, 1);
        // Let the last seam tick's scheduling work settle.
        await runTick(worker);
        expect(punchClock.start).toHaveLength(1);
        expect(punchClock.stop).toHaveLength(1);
        expect(punchClock.stop[0]).toBeCloseTo(TICK_SECONDS * 56, 3);
        expect(punchClock.stop[0]! - punchClock.start[0]!).toBeCloseTo(TICK_SECONDS * 28, 3);
        expect(schedulerSession.punchRecordingActive).toBe(false);
    });
});

/**
 * #4905 — the late wrap serves regions at or below the scheduler look-ahead
 * (0.2 beats at 120 BPM), where no seam is ever scheduled: `seamCapableRegion`
 * is false and every wrap goes through the post-crossing path. That path
 * replaces the scanned position with the incoming pass's overshoot BEFORE the
 * punch checks run, so the scan never revisits the dying pass's tail — where a
 * punch-out at or inside the region end lives. On the unfixed tree such a
 * punch-out never fires and the recording runs unbounded. The tick stride
 * (0.14 beats) exceeds the whole region, so every tick is a wrap and the
 * wrapped scan cycle is ~0.04, ~0.08, ~0.02, ~0.06 and a fifth landing near
 * zero.
 */
describe('startPlayheadScheduler punch at the late wrap on a sub-look-ahead region', () => {
    const LOOP_START_BEAT = 0;
    const LOOP_END_BEAT = 0.1;
    const PUNCH_IN_BEAT = 0.02;
    const PUNCH_OUT_AT_END_BEAT = 0.1;
    const PUNCH_OUT_BEFORE_END_BEAT = 0.09;
    const TICKS = 10;

    async function runTicks(worker: SchedulerWorkerHarness, count: number): Promise<void> {
        for (let tick = 0; tick < count; tick++) {
            await runTick(worker);
        }
    }

    function punchInsAt(anchorBeat: number): number {
        return vi
            .mocked(startRecording)
            .mock.calls.filter(([beat]) => beat !== undefined && Math.abs(beat - anchorBeat) < 1e-6).length;
    }

    function punchOutsAt(atBeat: number): number {
        return vi
            .mocked(stopRecording)
            .mock.calls.filter(([beat]) => beat !== undefined && Math.abs(beat - atBeat) < 1e-6).length;
    }

    beforeEach(() => {
        resetPunchHarness();
    });

    afterEach(() => {
        disposePlayheadScheduler();
        vi.unstubAllGlobals();
    });

    // The punch-out sits exactly on loopEnd. The wrapped scan can never reach
    // it (every wrapped position is below loopEnd), so only a punch-out due at
    // the wrap itself can close the recording. Asserted as a law rather than
    // exact counts: how many of the five scan landings fall inside the punch
    // region depends on which side of zero the fifth one's float dust lands,
    // but every pass the state machine opens must close at that pass's wrap.
    it('closes the punch recording at every wrap when the punch-out sits at loopEnd', async () => {
        trackStoreState.value = { tracks: [armedAudioTrack()] };
        transportStoreState.value = playingState({
            playheadPosition: LOOP_START_BEAT,
            isLooping: true,
            loopStart: LOOP_START_BEAT,
            loopEnd: LOOP_END_BEAT,
            punchInEnabled: true,
            punchInBeat: PUNCH_IN_BEAT,
            punchOutBeat: PUNCH_OUT_AT_END_BEAT,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();
        await runTicks(worker, TICKS);

        // The state machine re-arms across passes: the first wrap closes the
        // recording and the next in-region scan opens it again. Unfixed, the
        // first punch-in ran unbounded — one punch-in, zero punch-outs.
        expect(punchInsAt(PUNCH_IN_BEAT)).toBeGreaterThanOrEqual(2);
        // Every opened pass closed at its wrap.
        expect(punchOutsAt(PUNCH_OUT_AT_END_BEAT)).toBe(punchInsAt(PUNCH_IN_BEAT));
        expect(punchOutsAt(PUNCH_OUT_AT_END_BEAT)).toBeGreaterThanOrEqual(2);
        // Every punch-in is anchored at the region start — the max of the
        // punch point and the wrapped window's opening at loopStart.
        expect(vi.mocked(startRecording).mock.calls.length).toBe(punchInsAt(PUNCH_IN_BEAT));
        // The first punch-out is due at the very next wrap after the punch-in:
        // tick 1 opens, tick 2 wraps and must fire it.
        expect(punchClock.stop[0]).toBeCloseTo(TICK_SECONDS * 2, 3);
        expect(schedulerSession.punchRecordingActive).toBe(false);
    });

    // Companion: the punch-out sits strictly inside the region. Honest note
    // from the unfixed tree: it does eventually fire there — but only when a
    // wrapped scan landing just under loopEnd happens to clear the punch-out
    // beat, which on this geometry is ticks 5 and 10. The first punch-out
    // lands three wraps after it was due (~0.35 s instead of the wrap at
    // ~0.14 s), with the recording capturing past its punch-out point the
    // whole time, and only 2 of the 4 passes the state machine should cycle
    // actually happen. Fixed, it is due at the first wrap like any other.
    it('closes the punch recording at the wrap when the punch-out sits just before loopEnd', async () => {
        trackStoreState.value = { tracks: [armedAudioTrack()] };
        transportStoreState.value = playingState({
            playheadPosition: LOOP_START_BEAT,
            isLooping: true,
            loopStart: LOOP_START_BEAT,
            loopEnd: LOOP_END_BEAT,
            punchInEnabled: true,
            punchInBeat: PUNCH_IN_BEAT,
            punchOutBeat: PUNCH_OUT_BEFORE_END_BEAT,
        });

        startPlayheadScheduler();
        const worker = schedulerWorker();
        await runTicks(worker, TICKS);

        // Both scan landings that miss the punch region (the ~zero and the
        // just-below-loopEnd one) are settled here: the open/close cycle is
        // strictly alternating over ten ticks.
        expect(punchInsAt(PUNCH_IN_BEAT)).toBe(4);
        expect(punchOutsAt(PUNCH_OUT_BEFORE_END_BEAT)).toBe(4);
        // The first punch-out is due at the first wrap after the punch-in, not
        // at a later scan landing.
        expect(punchClock.stop[0]).toBeCloseTo(TICK_SECONDS * 2, 3);
        expect(schedulerSession.punchRecordingActive).toBe(false);
    });
});
