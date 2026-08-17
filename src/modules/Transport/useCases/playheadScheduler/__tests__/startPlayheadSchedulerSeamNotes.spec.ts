import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { CLICK_TIME_EPSILON, metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
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
    // Pulled in transitively: the scheduler reaches Levain's param bridge, whose
    // dependency bundle destructures these off this barrel at module scope. A
    // factory that omits them fails the whole file at import, not at a test.
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));
vi.mock('#/modules/MIDI/stores', () => ({
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
    startRecording: vi.fn(() => []),
    stopRecording: vi.fn(),
    addTakeLane: vi.fn(),
    addTake: vi.fn(),
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
const LOOP_SECONDS = LOOP_BEATS / BEATS_PER_SECOND;
const DOWNBEAT_PITCH = 60;
const JUMP_TARGET_BEAT = 8;
const JUMP_TARGET_PITCH = 67;

type ScheduledNoteRecord = { pitch: number; time: number; beat: number };

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

describe('startPlayheadScheduler note-seam coverage', () => {
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

    it('schedules the note sitting exactly on the loop start once per loop pass', async () => {
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

        startPlayheadScheduler();
        const worker = schedulerWorker();

        // Drive until the transport has wrapped twice — three passes over the
        // loop start in total (the initial pass plus two wraps).
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

        const downbeats = scheduled.filter((note) => Math.abs(note.beat) < 1e-3);
        // Exactly one firing per pass: three passes, three notes. This is the
        // over-fix side of the boundary. A seam rewind that the tick fails to
        // consume — anything that stops the high-water mark advancing past
        // `loopStart` — re-emits the note on every subsequent tick and lands
        // here well above 3, which is a different audible defect.
        expect(downbeats).toHaveLength(3);
        expect(downbeats.map((note) => note.pitch)).toEqual([DOWNBEAT_PITCH, DOWNBEAT_PITCH, DOWNBEAT_PITCH]);
        // And each firing lands one loop length apart on the audio clock, so the
        // three are genuinely one per pass rather than a burst inside one tick.
        expect(downbeats[1]!.time - downbeats[0]!.time).toBeCloseTo(LOOP_SECONDS, 4);
        expect(downbeats[2]!.time - downbeats[1]!.time).toBeCloseTo(LOOP_SECONDS, 4);
        // No other note exists in the fixture; nothing else may be emitted.
        expect(scheduled).toHaveLength(3);
    });

    it('does not double-click the metronome at the loop seam', async () => {
        // The seam anchor widens the metronome's window down to loopStart, and
        // the click on loopStart is the SAME physical instant as the click on
        // loopEnd the pre-wrap look-ahead already fired. Two clicks at one
        // instant is the audible flam the dedup exists to prevent.
        trackStoreState.value = { tracks: [] };
        midiStoreState.value = { notesByClipId: {}, probabilitySeed: 1 };
        transportStoreState.value = playingState({
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
            metronomeEnabled: true,
        });

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

        const clickTimes = scheduleClickSpy.mock.calls.map(([time]) => time).sort((left, right) => left - right);
        expect(clickTimes.length).toBeGreaterThan(0);
        const collisions = clickTimes.filter(
            (time, index) => index > 0 && Math.abs(time - clickTimes[index - 1]!) <= CLICK_TIME_EPSILON
        );
        expect(collisions).toEqual([]);
    });

    it('schedules the downbeat of the clip a follow action jumps to', async () => {
        trackStoreState.value = {
            tracks: [
                midiTrack([
                    midiClip('clip-source', 0, 4),
                    midiClip('clip-target', JUMP_TARGET_BEAT, JUMP_TARGET_BEAT + 4),
                ]),
            ],
        };
        midiStoreState.value = {
            notesByClipId: {
                'clip-source': [],
                'clip-target': [midiNote('note-target-downbeat', 0, JUMP_TARGET_PITCH)],
            },
            probabilitySeed: 1,
        };
        transportStoreState.value = playingState({ playheadPosition: 0 });

        startPlayheadScheduler();
        const worker = schedulerWorker();

        // One ordinary tick, then the follow action relocates the transport onto
        // the target clip's first beat.
        await runTick(worker);
        expect(scheduled).toHaveLength(0);

        evaluateFollowActionsMock.mockImplementationOnce(() => ({
            jumpToPosition: JUMP_TARGET_BEAT,
            shouldStop: false,
        }));
        await runTick(worker);

        const jumpTimeOnClock = ctxTime.now;
        const targetDownbeats = scheduled.filter((note) => Math.abs(note.beat - JUMP_TARGET_BEAT) < 1e-3);
        expect(targetDownbeats).toHaveLength(1);
        expect(targetDownbeats[0]!.pitch).toBe(JUMP_TARGET_PITCH);
        // The relocation makes the jump target the render origin, so the note on
        // it is due at the tick's own clock reading — not a look-ahead later.
        expect(targetDownbeats[0]!.time).toBeCloseTo(jumpTimeOnClock, 4);

        // Two further ticks of ordinary advance must not re-emit it.
        await runTick(worker);
        await runTick(worker);
        expect(scheduled.filter((note) => Math.abs(note.beat - JUMP_TARGET_BEAT) < 1e-3)).toHaveLength(1);
    });
});
