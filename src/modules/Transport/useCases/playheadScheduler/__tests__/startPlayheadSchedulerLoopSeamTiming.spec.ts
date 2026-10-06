import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * Seam coverage for the playhead scheduler, driven through the REAL
 * `scheduleMidiNotes` (the sibling `startPlayheadScheduler.spec.ts` mocks it, so
 * it can only observe that scheduling was requested, never what came out).
 * Everything below the note dispatch is stubbed, so `scheduleNote` is the
 * observation point: every assertion here is about a note the engine was
 * actually told to play, at the audio-clock time it was told to play it.
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
vi.mock('#/modules/Arrangement/useCases', () => ({
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
 * Second observation point: the metronome shares `lastScheduledBeat` as its
 * `fromBeat`, so moving the loop-wrap anchor moves the click window too.
 */
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
/**
 * The observation point. Typed to the four arguments the assertions read, so
 * the recorded pitch/time come from the production call rather than a cast.
 */
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
const BEATS_PER_SECOND = TEMPO_BPM / 60;
/**
 * 0.07 s per tick — deliberately not a divisor of the 2 s loop, so the wrap
 * overshoot is non-zero on every pass. A tick length that divides the loop
 * exactly lands `newPosition` on `loopEnd` and hides the defect behind a zero
 * overshoot.
 */
const TICK_SECONDS = 0.07;
const LOOP_BEATS = 4;
const DOWNBEAT_PITCH = 60;

type ScheduledNoteRecord = { pitch: number; time: number; beat: number; requestedAt: number };

function midiTrack(clips: unknown[]): unknown {
    return {
        id: 'track-1',
        kind: 'midi',
        muted: false,
        armed: false,
        parentId: null,
        followChordTrack: false,
        automationMode: 'read',
        devices: [],
        clips,
        freezeState: { status: 'unfrozen', frozenBufferId: null },
    };
}

function midiClip(id: string, startBeat: number, endBeat: number): unknown {
    return {
        id,
        type: 'midi',
        muted: false,
        startBeat,
        endBeat,
        gain: 1,
        loopEnabled: false,
        midiOffsetBeats: 0,
    };
}

function midiNote(id: string, startBeat: number, pitch: number): unknown {
    return { id, startBeat, duration: 0.5, pitch, velocity: 100, probability: 100 };
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

// Audit #4591 — the loop wrap is detected only after the playhead has passed
// loopEnd, so material at loopStart is requested behind the audio clock (late
// by the overshoot on every pass), while the pre-wrap look-ahead has already
// started material that lies after loopEnd.
describe('startPlayheadScheduler loop-seam timing', () => {
    let scheduled: ScheduledNoteRecord[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        scheduled = [];
        // The engine is told a pitch and an absolute AudioContext time. Recover
        // the musical beat the way the production formula built it, so the
        // assertions below name a beat rather than an opaque timestamp:
        //   time = now + (noteBeat - accumulatedPosition) / beatsPerSecond
        scheduleNoteSpy.mockImplementation((_ctx, _destination, pitch, time) => {
            scheduled.push({
                pitch,
                time,
                beat: schedulerSession.accumulatedPosition + (time - ctxTime.now) * BEATS_PER_SECOND,
                requestedAt: ctxTime.now,
            });
            return {};
        });
        evaluateFollowActionsMock.mockImplementation(() => ({ jumpToPosition: null, shouldStop: false }));
        tempoMapStoreState.value = { changes: [] };
        midiStoreState.value = null;
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

    async function runUntilTwoWraps(): Promise<void> {
        startPlayheadScheduler();
        const worker = schedulerWorker();
        let wraps = 0;
        let previousPosition = schedulerSession.accumulatedPosition;
        let ticks = 0;
        while (wraps < 2 && ticks < 500) {
            ticks++;
            await runTick(worker);
            if (schedulerSession.accumulatedPosition < previousPosition) {
                wraps++;
            }
            previousPosition = schedulerSession.accumulatedPosition;
        }
        expect(wraps).toBe(2);
    }

    it('requests the loop-start downbeat of every wrapped pass at or after the audio clock', async () => {
        trackStoreState.value = { tracks: [midiTrack([midiClip('clip-loop', 0, LOOP_BEATS)])] };
        midiStoreState.value = {
            notesByClipId: { 'clip-loop': [midiNote('note-downbeat', 0, DOWNBEAT_PITCH)] },
            probabilitySeed: 1,
        };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
        });

        await runUntilTwoWraps();

        const downbeats = scheduled.filter((note) => note.pitch === DOWNBEAT_PITCH);
        expect(downbeats).toHaveLength(3);
        // The two downbeats after each wrap.
        const lateBySeconds = downbeats.slice(1).map((note) => Math.max(0, note.requestedAt - note.time));
        expect(lateBySeconds.map((late) => Number(late.toFixed(3)))).toEqual([0, 0]);
    });

    it('never schedules material after loopEnd while the loop is on', async () => {
        const AFTER_LOOP_PITCH = 72;
        trackStoreState.value = {
            tracks: [midiTrack([midiClip('clip-loop', 0, LOOP_BEATS), midiClip('clip-after', LOOP_BEATS, 8)])],
        };
        midiStoreState.value = {
            notesByClipId: {
                'clip-loop': [midiNote('note-downbeat', 0, DOWNBEAT_PITCH)],
                'clip-after': [midiNote('note-after', 0, AFTER_LOOP_PITCH)],
            },
            probabilitySeed: 1,
        };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
        });

        await runUntilTwoWraps();

        expect(scheduled.filter((note) => note.pitch === AFTER_LOOP_PITCH)).toEqual([]);
    });

    // #4668 — the wrap count a backwards event-time capture reads must count
    // exactly the wraps the published cursor has crossed: reset when the roll
    // begins, advanced once per seam the clock actually pivots on — not at the
    // look-ahead detection, which runs one grain before that pivot.
    it('counts the wraps the published cursor has crossed since the roll began', async () => {
        trackStoreState.value = { tracks: [midiTrack([midiClip('clip-loop', 0, LOOP_BEATS)])] };
        midiStoreState.value = {
            notesByClipId: { 'clip-loop': [midiNote('note-downbeat', 0, DOWNBEAT_PITCH)] },
            probabilitySeed: 1,
        };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
        });
        // A stale count from an earlier roll must not survive the restart.
        playheadWrapCountRef.current = 7;

        startPlayheadScheduler();
        expect(playheadWrapCountRef.current).toBe(0);

        // Drive ticks until the count itself reaches two wraps. The scheduled
        // seam moves `accumulatedPosition` one look-ahead before the pivot, so
        // a position-drop loop would exit while the published cursor is still
        // on the dying pass — exactly the window the count deliberately stays
        // behind in.
        const worker = schedulerWorker();
        let ticks = 0;
        while (playheadWrapCountRef.current < 2 && ticks < 500) {
            ticks++;
            await runTick(worker);
        }

        expect(playheadWrapCountRef.current).toBe(2);
    });
});
