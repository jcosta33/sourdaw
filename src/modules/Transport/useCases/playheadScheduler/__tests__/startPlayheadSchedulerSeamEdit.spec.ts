import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
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
/**
 * First observation point: one call per tick carrying the published beat, so
 * the whole run's published clock can be replayed and range-checked.
 */
const applyModulationSpy = vi.hoisted(() => vi.fn<(beat: number) => void>());
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    applyModulation: applyModulationSpy,
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
/**
 * Marks the seam tick: the seam branch is the only thing that panics the yeast
 * runtime in these fixtures.
 */
const panicYeastRuntimeSpy = vi.hoisted(() => vi.fn<() => Promise<void>>(() => Promise.resolve()));
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
const EDITED_BPM = 60;
const DYING_NOTE_BEAT = 3.95;
const DYING_NOTE_PITCH = 75;

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

async function runTick(worker: SchedulerWorkerHarness, seconds = TICK_SECONDS): Promise<void> {
    ctxTime.now += seconds;
    emitSchedulerTick(worker);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function schedulerWorker(): SchedulerWorkerHarness {
    return schedulerSession.worker as unknown as SchedulerWorkerHarness;
}

describe('startPlayheadScheduler seam vs mid-playback edit', () => {
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

    // A tempo edit landing between the seam tick and the stale seam instant used
    // to keep the pending seam alive: the published clock integrated the OLD
    // anchor under the NEW map until the stale instant, then fell into the
    // incoming pass's negative phase — published beats below loopStart — and the
    // rewound high-water mark re-opened the emission window at the incoming
    // phase, so the dying pass's remaining material never re-emitted after the
    // edit's teardown had cut it.
    it('re-anchors out of negative phase when an edit lands inside the pending window', async () => {
        trackStoreState.value = { tracks: [midiTrack([midiClip('clip-loop', 0, LOOP_BEATS)])] };
        midiStoreState.value = {
            notesByClipId: { 'clip-loop': [midiNote('note-dying', DYING_NOTE_BEAT, DYING_NOTE_PITCH)] },
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

        // Drive to the scheduled-seam tick — the first yeast panic marks it
        // (t≈1.96 s, playhead ≈3.92, seam instant ≈2.0 s on the old map).
        let ticks = 0;
        while (panicYeastRuntimeSpy.mock.calls.length === 0 && ticks < 200) {
            ticks++;
            await runTick(worker);
        }
        expect(panicYeastRuntimeSpy).toHaveBeenCalled();

        // One fine tick past the seam tick (t≈1.97 s, still short of the stale
        // seam instant), then the tempo map is replaced by a 60 BPM one.
        await runTick(worker, 0.01);
        tempoMapStoreState.value = {
            changes: [{ id: 'tempo-edit', beat: 0, tempo: EDITED_BPM, curve: 'instant' }],
        };

        // Run the pending window out under the new map and well past the stale
        // seam instant (t≈2.22 s).
        for (let index = 0; index < 25; index++) {
            await runTick(worker, 0.01);
        }

        // Every published beat across the whole run stays inside the region —
        // never the incoming pass's negative phase, never past loopEnd.
        const publishedBeats = applyModulationSpy.mock.calls.map(([beat]) => beat);
        expect(publishedBeats.length).toBeGreaterThan(0);
        for (const beat of publishedBeats) {
            expect(beat, `published beat ${beat}`).toBeGreaterThanOrEqual(-1e-9);
            expect(beat, `published beat ${beat}`).toBeLessThanOrEqual(LOOP_BEATS);
        }

        // The dying remainder's note — sitting inside the window the edit's
        // teardown cut — still fires after the edit: re-emitted once at its
        // original grid time and once by the re-anchored window, and nothing
        // more (no re-emission storm). The re-anchored window opens at the
        // PREVIOUS tick's dying position (t≈1.97 s), so the main integration
        // lands the re-emission on the note's exact grid time under the new
        // map: 3.95 beats at 60 BPM is t≈1.99 s. Anchoring at the tick's own
        // `now` instead double-counted the last grain and fired it at t≈1.98.
        const dying = scheduled.filter((note) => note.pitch === DYING_NOTE_PITCH);
        expect(dying.map((note) => note.time).sort((left, right) => left - right)).toEqual([
            expect.any(Number),
            expect.any(Number),
        ]);
        expect(dying[0]!.time).toBeCloseTo(1.975, 3);
        expect(dying[1]!.time).toBeCloseTo(1.99, 3);
        expect(scheduled).toHaveLength(2);
    });
});
