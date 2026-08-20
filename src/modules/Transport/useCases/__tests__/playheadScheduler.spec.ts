import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { scheduleAdjustmentLayers, stopAllScheduled } from '#/modules/AudioEngine/useCases';
import { startAutomationRecording, stopAutomationRecording } from '#/modules/Automation/useCases';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { type TempoMapStoreState } from '../../stores/tempoMapStore';
import { evaluateFollowActions } from '../evaluateFollowActions';
import { disposePlayheadScheduler } from '../playheadScheduler/disposePlayheadScheduler';
import { schedulerSession } from '../playheadScheduler/schedulerSession';
import { startPlayheadScheduler } from '../playheadScheduler/startPlayheadScheduler';
import { stopPlayheadScheduler } from '../playheadScheduler/stopPlayheadScheduler';
import { applyAutomation } from '../scheduling/applyAutomation/applyAutomation';
import { applyVcaGains } from '../scheduling/applyAutomation/applyVcaGains';
import { disposeAudioClipScheduling } from '../scheduling/disposeAudioClipScheduling';
import { scheduleAudioClips } from '../scheduling/scheduleAudioClips';
import { scheduleMidiNotes } from '../scheduling/scheduleMidiNotes';
import { panicYeastRuntime } from '../transportControls/panicYeastRuntime';

type FakeWorker = {
    onmessage: ((e: MessageEvent<unknown>) => void) | null;
    postMessage: (msg: unknown) => void;
    terminate: () => void;
};

type TestRecordingClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio';
    audioBufferId?: string;
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
};

type UpdateClipMock = (clipId: string, updater: (clip: TestRecordingClip) => TestRecordingClip) => void;

type StartAudioRecordingMock = (trackId: string, onComplete: (buffer: AudioBuffer) => void) => Promise<boolean>;

type CacheAudioBufferMock = (input: { buffer: AudioBuffer; bufferId?: string }) => string;

// Shared mutable test state, hoisted so the vi.mock factories below can close
// over it (vi.mock factories are hoisted above imports).
const harness = vi.hoisted(() => ({
    clock: 0,
    logger: {
        error: vi.fn(),
    },
    cache_audio_buffer: vi.fn<CacheAudioBufferMock>(({ bufferId }) => bufferId ?? 'generated-test-buffer'),
    setTransportInfo: vi.fn(),
    start_audio_recording: vi.fn<StartAudioRecordingMock>(() => Promise.resolve(true)),
    start_recording: vi.fn<() => TestRecordingClip[]>(() => []),
    stop_audio_recording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    stop_recording: vi.fn<() => void>(),
    panic_yeast_runtime: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    workers: [] as FakeWorker[],
    track_store: { value: { tracks: [] as { id: string; kind: 'audio' | 'midi'; armed: boolean }[] } },
    transport_store: {
        value: null as import('../../stores/transportStore').TransportState | null,
        set: vi.fn(),
    },
    tempo_map_store: {
        value: { changes: [] as TempoMapStoreState['changes'] },
    },
    update_clip: vi.fn<UpdateClipMock>(),
}));

vi.mock('../../stores/transportStore', () => ({
    transportStore: harness.transport_store,
}));
vi.mock('../../stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: harness.tempo_map_store,
}));
vi.mock('../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: harness.track_store,
    takeLaneStore: { value: { lanes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    addTakeLane: vi.fn(),
    addTake: vi.fn(),
    startRecording: harness.start_recording,
    stopRecording: harness.stop_recording,
    updateClip: harness.update_clip,
}));
vi.mock('../evaluateFollowActions', () => ({
    evaluateFollowActions: vi.fn(() => ({ jumpToPosition: null, shouldStop: false })),
}));
vi.mock('../transportControls/panicYeastRuntime', () => ({
    panicYeastRuntime: harness.panic_yeast_runtime,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: harness.cache_audio_buffer,
    stopAllScheduled: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    startAudioRecording: harness.start_audio_recording,
    stopAudioRecording: harness.stop_audio_recording,
    getAudioContext: vi.fn(() => ({
        get currentTime() {
            return harness.clock;
        },
        createGain: vi.fn(() => ({
            gain: {
                value: 1,
                cancelScheduledValues: vi.fn(),
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
        })),
    })),
    audioEngine: {
        setTransportInfo: (...args: unknown[]): void => {
            harness.setTransportInfo(...args);
        },
    },
    scheduleAdjustmentLayers: vi.fn(),
    // Missing from this mock until MD-5: every tick threw here, so the tail of
    // runTick — including the `lastScheduledBeat` high-water-mark update the
    // MIDI re-emission gate reads — never ran under test. Any assertion about
    // scheduling windows was vacuous while that hole was open.
    refreshSidechainAlignment: vi.fn(),
    getCompensationDelay: vi.fn(() => 0),
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: harness.logger }));
vi.mock('../scheduling/scheduleMetronome', () => ({
    scheduleMetronome: vi.fn(),
}));
vi.mock('../scheduling/resetMetronomeBeat', () => ({
    resetMetronomeBeat: vi.fn(),
}));
vi.mock('../scheduling/scheduleAudioClips', () => ({
    scheduleAudioClips: vi.fn(),
}));
vi.mock('../scheduling/disposeAudioClipScheduling', () => ({
    disposeAudioClipScheduling: vi.fn(),
}));
vi.mock('../scheduling/applyAutomation/applyVcaGains', () => ({
    applyVcaGains: vi.fn(),
}));
vi.mock('../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    stopAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
}));
vi.mock('../scheduling/scheduleMidiNotes', () => ({
    scheduleMidiNotes: vi.fn(() => Promise.resolve()),
}));

// Stub the Worker the scheduler creates so we can capture its message handler
// and drive ticks synchronously instead of relying on a real worker thread.
const OriginalWorker = globalThis.Worker;
let schedulerTickSequence = 0;
beforeEach(() => {
    harness.clock = 0;
    harness.workers = [];
    schedulerTickSequence = 0;
    class WorkerStub {
        onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        constructor() {
            harness.workers.push(this);
        }
    }
    globalThis.Worker = WorkerStub as unknown as typeof Worker;
});
afterEach(() => {
    globalThis.Worker = OriginalWorker;
});

function emitSchedulerTick(worker: FakeWorker): void {
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
    } as MessageEvent<unknown>);
}

const playingTransport = {
    isPlaying: true,
    isRecording: false,
    isLooping: false,
    overdubEnabled: false,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    playheadPosition: 0,
    loopStart: 0,
    loopEnd: 0,
    scheduleGrainMs: 10,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    countInEnabled: false,
    countInBars: 1,
    preRollEnabled: false,
    preRollBars: 2,
    masterGain: 80,
};

/** Fire one scheduler tick through the captured worker handler. */
async function fireTick(): Promise<void> {
    const worker = harness.workers[harness.workers.length - 1]!;
    emitSchedulerTick(worker);
    // tick() is async; flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
}

function create_test_audio_buffer(): AudioBuffer {
    return {
        duration: 1,
        length: 48000,
        numberOfChannels: 1,
        sampleRate: 48000,
        copyFromChannel: () => {},
        copyToChannel: () => {},
        getChannelData: () => new Float32Array(48000),
    } satisfies AudioBuffer;
}

describe('startPlayheadScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        harness.transport_store.value = null;
        harness.start_audio_recording.mockResolvedValue(true);
        harness.stop_audio_recording.mockResolvedValue();
    });

    it('does not start automation recording when transport state is missing', () => {
        startPlayheadScheduler();

        expect(startAutomationRecording).not.toHaveBeenCalled();
    });

    it('clears stale dedup Sets and stops orphaned sources from a skipped teardown', () => {
        // Pause's recording-flush continuation deliberately skips scheduler
        // teardown when a play landed during the flush. The fresh session must
        // not inherit the old one's dedup Sets (a stale frozen entry would
        // suppress rescheduling for the whole session) or its still-playing
        // sources (they would play out of sync with the restarted playhead).
        harness.transport_store.value = { ...playingTransport };
        const orphanSource = { stop: vi.fn() } as unknown as AudioBufferSourceNode;
        schedulerSession.activeAudioSources.push(orphanSource);
        schedulerSession.scheduledAudioClips.add('stale-clip');
        schedulerSession.scheduledFrozenTracks.add('stale-track');

        startPlayheadScheduler();

        expect(schedulerSession.scheduledAudioClips.size).toBe(0);
        expect(schedulerSession.scheduledFrozenTracks.size).toBe(0);
        expect(orphanSource.stop).toHaveBeenCalled();
        expect(schedulerSession.activeAudioSources).toHaveLength(0);

        disposePlayheadScheduler();
    });
});

describe('stopPlayheadScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        harness.start_audio_recording.mockResolvedValue(true);
        harness.stop_audio_recording.mockResolvedValue();
    });

    it('stops automation recording', () => {
        stopPlayheadScheduler();

        expect(stopAutomationRecording).toHaveBeenCalled();
    });
});

describe('playhead scheduler tick', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        harness.clock = 0;
        playheadPositionRef.current = 0;
        harness.tempo_map_store.value = { changes: [] };
        harness.transport_store.value = { ...playingTransport };
        harness.track_store.value = { tracks: [] };
        disposePlayheadScheduler();
    });

    afterEach(() => {
        disposePlayheadScheduler();
    });

    it('clamps a suspended/resumed clock leap so the playhead does not skip events (regression: §B fix 1)', async () => {
        startPlayheadScheduler();

        // Normal small tick: 0.05 s at 120bpm (2 beats/s) advances 0.1 beats.
        harness.clock = 0.05;
        await fireTick();
        expect(playheadPositionRef.current).toBeCloseTo(0.1, 6);

        // The context was suspended and resumed: the clock leaps forward 5 s. An
        // unclamped delta would advance 5 * 2 = 10 beats in a single tick, skipping
        // every event in between. The clamp caps the advance at one grain window
        // (SCHEDULE_AHEAD_SECONDS = 0.1 s -> 0.2 beats).
        harness.clock = 5.05;
        await fireTick();
        expect(playheadPositionRef.current).toBeCloseTo(0.3, 6); // 0.1 + clamp(0.2)
        expect(playheadPositionRef.current).toBeLessThan(1);
    });

    it('invalidates scheduled clips when the tempo map changes mid-playback (regression: §B fix 4)', async () => {
        startPlayheadScheduler();

        // First steady tick — no change, so no invalidation teardown.
        harness.clock = 0.05;
        await fireTick();
        const stopCallsBefore = vi.mocked(stopAllScheduled).mock.calls.length;

        // A mid-playback tempo edit replaces the changes array reference.
        harness.tempo_map_store.value = { changes: [{ id: 't1', beat: 0, tempo: 90, curve: 'instant' }] };
        harness.clock = 0.1;
        await fireTick();

        // The tempo-map change must trigger the same teardown the loop-wrap uses
        // (stopAllScheduled) so clips re-schedule at the new rate.
        expect(vi.mocked(stopAllScheduled).mock.calls.length).toBeGreaterThan(stopCallsBefore);
    });

    it('invalidates scheduled clips when the loop region changes mid-playback (regression: §B fix 4)', async () => {
        startPlayheadScheduler();

        harness.clock = 0.05;
        await fireTick();
        const stopCallsBefore = vi.mocked(stopAllScheduled).mock.calls.length;

        // Move the loop region without wrapping.
        harness.transport_store.value = { ...playingTransport, loopStart: 2, loopEnd: 6 };
        harness.clock = 0.1;
        await fireTick();

        expect(vi.mocked(stopAllScheduled).mock.calls.length).toBeGreaterThan(stopCallsBefore);
    });

    // audit MD-5 — MIDI notes have no dedup Set; they are gated by the
    // monotonic high-water mark, which the invalidation above does not move.
    // Notes already emitted into the look-ahead are silenced by allNotesOff and
    // then blocked from re-emission, so an edit drops a whole window of them.
    it('re-opens the MIDI window a tempo edit just cut so notes in it sound again at the new rate', async () => {
        startPlayheadScheduler();

        harness.clock = 0.05;
        await fireTick();
        // At 120bpm the first tick scheduled MIDI up to beat 0.3 and moved the
        // high-water mark there; a note at 0.2 is inside that emitted window.
        const positionAtEdit = playheadPositionRef.current;
        const noteInCutWindow = 0.2;
        expect(noteInCutWindow).toBeGreaterThan(positionAtEdit);

        harness.tempo_map_store.value = { changes: [{ id: 't1', beat: 0, tempo: 90, curve: 'instant' }] };
        harness.clock = 0.1;
        await fireTick();

        const [fromBeat, toBeat] = vi.mocked(scheduleMidiNotes).mock.calls.at(-1) ?? [];
        // The real re-emission gate in scheduleMidiNotes:
        // `startBeat < fromBeat || startBeat >= toBeat`, where `fromBeat` is the
        // high-water mark the transport rewound for this re-emit. Assert the
        // strict inequality, deliberately stronger than the gate: the rewind has
        // to land strictly below the cut note, not merely at it, or an epsilon
        // that shrinks to zero would leave the boundary note on the gate's edge.
        expect(noteInCutWindow).toBeGreaterThan(fromBeat as number);
        expect(noteInCutWindow).toBeLessThan(toBeat as number);
    });

    it('re-opens the MIDI window on a loop-region edit as well', async () => {
        startPlayheadScheduler();

        harness.clock = 0.05;
        await fireTick();
        const noteInCutWindow = 0.2;

        harness.transport_store.value = { ...playingTransport, loopStart: 2, loopEnd: 6 };
        harness.clock = 0.1;
        await fireTick();

        const [fromBeat, toBeat] = vi.mocked(scheduleMidiNotes).mock.calls.at(-1) ?? [];
        // Strict, as above: the rewound high-water mark must sit below the note.
        expect(noteInCutWindow).toBeGreaterThan(fromBeat as number);
        expect(noteInCutWindow).toBeLessThan(toBeat as number);
    });

    it('keeps the MIDI high-water mark monotonic across steady ticks so notes are not re-emitted twice', async () => {
        startPlayheadScheduler();

        harness.clock = 0.05;
        await fireTick();
        harness.clock = 0.1;
        await fireTick();
        const [afterSecond] = vi.mocked(scheduleMidiNotes).mock.calls.at(-1) ?? [];
        harness.clock = 0.15;
        await fireTick();
        const [afterThird] = vi.mocked(scheduleMidiNotes).mock.calls.at(-1) ?? [];

        expect(afterThird as number).toBeGreaterThan(afterSecond as number);
    });

    it('does not invalidate when neither tempo map nor loop region changes', async () => {
        startPlayheadScheduler();

        harness.clock = 0.05;
        await fireTick();
        const stopCallsBefore = vi.mocked(stopAllScheduled).mock.calls.length;

        harness.clock = 0.1;
        await fireTick();
        harness.clock = 0.15;
        await fireTick();

        expect(vi.mocked(stopAllScheduled).mock.calls.length).toBe(stopCallsBefore);
    });

    it('advances a semantic discontinuity epoch on a real scheduler loop wrap', async () => {
        harness.transport_store.value = {
            ...playingTransport,
            isLooping: true,
            loopStart: 0,
            loopEnd: 0.15,
        };
        startPlayheadScheduler();

        harness.clock = 0.05;
        await fireTick();
        const beforeWrap = vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7];
        const beforeWrapEpoch = beforeWrap?.discontinuityEpoch;

        harness.clock = 0.1;
        await fireTick();
        const afterWrap = vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7];

        expect(beforeWrapEpoch).toEqual(expect.any(Number));
        expect(afterWrap?.discontinuityEpoch).toBeGreaterThan(beforeWrapEpoch ?? 0);
        expect(afterWrap?.generation).toBe(beforeWrap?.generation);
        expect(panicYeastRuntime).toHaveBeenCalledTimes(1);
        expect(vi.mocked(panicYeastRuntime).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(scheduleMidiNotes).mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY
        );
    });

    it('advances a semantic discontinuity epoch on a real scheduler follow-action jump', async () => {
        startPlayheadScheduler();
        harness.clock = 0.05;
        await fireTick();
        const beforeJump = vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7];
        const beforeJumpEpoch = beforeJump?.discontinuityEpoch;

        vi.mocked(evaluateFollowActions).mockReturnValueOnce({ jumpToPosition: 8, shouldStop: false });
        harness.clock = 0.1;
        await fireTick();
        const afterJump = vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7];

        expect(afterJump?.discontinuityEpoch).toBeGreaterThan(beforeJumpEpoch ?? 0);
        expect(afterJump?.generation).toBe(beforeJump?.generation);
        expect(panicYeastRuntime).toHaveBeenCalledTimes(1);
        expect(vi.mocked(panicYeastRuntime).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(scheduleMidiNotes).mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY
        );
    });

    it('uses a new semantic discontinuity epoch when the scheduler restarts', async () => {
        startPlayheadScheduler();
        harness.clock = 0.05;
        await fireTick();
        const beforeRestart = vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7];
        const beforeRestartEpoch = beforeRestart?.discontinuityEpoch;
        const beforeRestartGeneration = beforeRestart?.generation;

        stopPlayheadScheduler();
        harness.transport_store.value = { ...playingTransport };
        harness.clock = 0.1;
        startPlayheadScheduler();
        harness.clock = 0.15;
        await fireTick();
        const afterRestart = vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7];

        expect(afterRestart?.discontinuityEpoch).toBeGreaterThan(beforeRestartEpoch ?? 0);
        expect(afterRestart?.generation).toBeGreaterThan(beforeRestartGeneration ?? 0);
    });

    it('should cache punch-in audio completion through the AudioEngine use case and update the recording clip', async () => {
        const random_uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
        const recording_clip = {
            id: 'rec-clip-1',
            trackId: 'track-audio-1',
            name: 'Recording 1',
            startBeat: 0,
            endBeat: 0,
            type: 'audio' as const,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        harness.track_store.value = {
            tracks: [{ id: 'track-audio-1', kind: 'audio', armed: true }],
        };
        harness.transport_store.value = {
            ...playingTransport,
            punchInEnabled: true,
            punchInBeat: 0.05,
            punchOutBeat: 4,
        };
        harness.start_recording.mockReturnValue([recording_clip]);

        try {
            startPlayheadScheduler();

            harness.clock = 0.05;
            await fireTick();

            expect(harness.start_audio_recording).toHaveBeenCalledWith('track-audio-1', expect.any(Function));

            const complete_recording = harness.start_audio_recording.mock.calls[0]![1];
            const buffer = create_test_audio_buffer();
            complete_recording(buffer);

            expect(harness.cache_audio_buffer).toHaveBeenCalledWith({
                buffer,
                bufferId: 'rec-00000000-0000-4000-8000-000000000001',
            });
            expect(harness.update_clip).toHaveBeenCalledWith('rec-clip-1', expect.any(Function));

            const update_clip_call = harness.update_clip.mock.calls[0]!;
            const updated_clip = update_clip_call[1]({
                ...recording_clip,
                audioBufferId: 'old-buffer',
            });
            expect(updated_clip).toEqual({
                ...recording_clip,
                audioBufferId: 'rec-00000000-0000-4000-8000-000000000001',
            });
        } finally {
            random_uuid.mockRestore();
        }
    });

    it('logs when punch-in audio recording fails to start', async () => {
        const recordingError = new Error('microphone unavailable');
        harness.track_store.value = {
            tracks: [{ id: 'track-audio-1', kind: 'audio', armed: true }],
        };
        harness.transport_store.value = {
            ...playingTransport,
            punchInEnabled: true,
            punchInBeat: 0.05,
            punchOutBeat: 4,
        };
        harness.start_recording.mockReturnValue([]);
        harness.start_audio_recording.mockRejectedValueOnce(recordingError);

        startPlayheadScheduler();
        harness.clock = 0.05;
        await fireTick();

        expect(harness.start_audio_recording).toHaveBeenCalledWith('track-audio-1', expect.any(Function));

        // The `.catch` on startAudioRecording must surface the rejection as an
        // Error whose message names the punch-in path and whose cause is the
        // original rejection.
        await vi.waitFor(() =>
            expect(harness.logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: recordingError }))
        );
        const loggedError = harness.logger.error.mock.calls
            .map((call): unknown => call[0])
            .find((arg): arg is Error => arg instanceof Error && arg.cause === recordingError);
        if (!(loggedError instanceof Error)) {
            throw new Error('Expected the punch-in failure to be logged as an Error');
        }
        expect(loggedError.message).toBe('Punch-in audio recording failed to start');
        expect(loggedError.cause).toBe(recordingError);
    });

    it('disposePlayheadScheduler terminates the worker and clears the audio-clip pool (regression: §B fix 5)', async () => {
        startPlayheadScheduler();
        const worker = harness.workers[harness.workers.length - 1]!;

        harness.clock = 0.05;
        await fireTick();

        const beforeDisposeEpoch = vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7]?.discontinuityEpoch;
        disposePlayheadScheduler();

        expect(vi.mocked(worker.terminate)).toHaveBeenCalled();
        expect(vi.mocked(disposeAudioClipScheduling)).toHaveBeenCalled();
        startPlayheadScheduler();
        harness.clock = 0.1;
        await fireTick();
        expect(vi.mocked(scheduleMidiNotes).mock.calls.at(-1)?.[7]?.discontinuityEpoch).toBeGreaterThan(
            beforeDisposeEpoch ?? 0
        );
    });

    // audit row 1 — `tick` is async and awaits scheduleMidiNotes (the Yeast
    // Worker round-trip). If that await outruns the scheduler interval, the next
    // worker message must NOT start a second tick body while the first is still
    // suspended — both would mutate the shared session mutables (accumulatedPosition,
    // lastScheduledBeat, the dedup Sets, playheadPositionRef) concurrently.
    it('does not start a second overlapping tick while a prior tick is awaiting (audit row 1)', async () => {
        // Hold scheduleMidiNotes suspended on a promise we resolve by hand, so the
        // first tick is in-flight across the second worker message.
        let releaseMidi: (() => void) | null = null;
        const midiPending = new Promise<void>((resolve) => {
            releaseMidi = () => resolve();
        });
        vi.mocked(scheduleMidiNotes).mockReturnValueOnce(midiPending);

        startPlayheadScheduler();
        const worker = harness.workers[harness.workers.length - 1]!;

        // Fire tick #1. It advances to the `await scheduleMidiNotes` and suspends.
        harness.clock = 0.05;
        emitSchedulerTick(worker);
        await Promise.resolve();
        await Promise.resolve();

        const positionAfterFirst = playheadPositionRef.current;
        const midiCallsAfterFirst = vi.mocked(scheduleMidiNotes).mock.calls.length;
        const transportSyncsAfterFirst = harness.setTransportInfo.mock.calls.length;
        expect(midiCallsAfterFirst).toBe(1);

        // Fire tick #2 while #1 is still suspended on its await. The guard must make
        // it a no-op: no second scheduleMidiNotes call, no extra playhead advance,
        // no extra transport sync.
        harness.clock = 0.1;
        emitSchedulerTick(worker);
        await Promise.resolve();
        await Promise.resolve();

        expect(vi.mocked(scheduleMidiNotes).mock.calls.length).toBe(midiCallsAfterFirst);
        expect(playheadPositionRef.current).toBe(positionAfterFirst);
        expect(harness.setTransportInfo.mock.calls.length).toBe(transportSyncsAfterFirst);

        // Release tick #1. A subsequent tick may run normally again.
        releaseMidi!();
        await Promise.resolve();
        await Promise.resolve();

        harness.clock = 0.15;
        await fireTick();
        expect(vi.mocked(scheduleMidiNotes).mock.calls.length).toBeGreaterThan(midiCallsAfterFirst);
    });

    it('contains a rejected Yeast scheduling tick and allows the next tick to run', async () => {
        const schedulingError = new Error('Yeast scheduling failed');
        vi.mocked(scheduleMidiNotes).mockRejectedValueOnce(schedulingError);

        startPlayheadScheduler();
        harness.clock = 0.05;
        await fireTick();

        await vi.waitFor(() =>
            expect(harness.logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: schedulingError }))
        );
        expect(scheduleMidiNotes).toHaveBeenCalledOnce();

        harness.clock = 0.1;
        await fireTick();
        expect(scheduleMidiNotes).toHaveBeenCalledTimes(2);
    });

    it('waits for punch-out recorder teardown before finalizing the recording', async () => {
        const order: string[] = [];
        let finishRecordingStop: (() => void) | undefined;
        const recordingFlush = new Promise<void>((resolve) => {
            finishRecordingStop = resolve;
        });
        harness.stop_audio_recording.mockReturnValueOnce(recordingFlush);
        harness.stop_recording.mockImplementationOnce(() => {
            order.push('stopRecording');
        });
        harness.track_store.value = {
            tracks: [{ id: 'track-audio-1', kind: 'audio', armed: true }],
        };
        harness.transport_store.value = {
            ...playingTransport,
            punchInEnabled: true,
            punchInBeat: 0.05,
            punchOutBeat: 4,
        };

        startPlayheadScheduler();
        harness.clock = 0.05;
        await fireTick();

        const currentTransport = harness.transport_store.value;
        if (!currentTransport) {
            throw new Error('Expected transport state to be initialized');
        }
        harness.transport_store.value = {
            ...currentTransport,
            isRecording: true,
            punchOutBeat: 0.15,
        };
        harness.clock = 0.1;
        await fireTick();

        expect(order).toEqual([]);
        expect(harness.stop_audio_recording).toHaveBeenCalledOnce();
        const finish = finishRecordingStop;
        if (!finish) {
            throw new Error('Expected punch-out recorder teardown to be pending');
        }
        finish();
        await vi.waitFor(() => expect(harness.stop_recording).toHaveBeenCalledOnce());
        expect(order).toEqual(['stopRecording']);
    });

    it('reports a recorder rejection during scheduler teardown without leaving the session active', async () => {
        const recordingError = new Error('scheduler recorder stop failed');
        harness.track_store.value = {
            tracks: [{ id: 'track-audio-1', kind: 'audio', armed: true }],
        };
        harness.transport_store.value = {
            ...playingTransport,
            punchInEnabled: true,
            punchInBeat: 0.05,
            punchOutBeat: 4,
        };

        startPlayheadScheduler();
        harness.clock = 0.05;
        await fireTick();
        harness.stop_audio_recording.mockRejectedValueOnce(recordingError);

        stopPlayheadScheduler();

        await vi.waitFor(() =>
            expect(harness.logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: recordingError }))
        );
        expect(harness.stop_recording).toHaveBeenCalledOnce();
    });

    it.each(['pause', 'stop', 'seek'])(
        'does not schedule post-await work after the %s teardown invalidates the tick',
        async () => {
            let releaseMidi: (() => void) | null = null;
            const midiPending = new Promise<void>((resolve) => {
                releaseMidi = resolve;
            });
            vi.mocked(scheduleMidiNotes).mockReturnValueOnce(midiPending);

            startPlayheadScheduler();
            const worker = harness.workers[harness.workers.length - 1]!;
            harness.clock = 0.05;
            emitSchedulerTick(worker);
            await Promise.resolve();
            await Promise.resolve();

            stopPlayheadScheduler();
            releaseMidi!();
            await Promise.resolve();
            await Promise.resolve();

            expect(vi.mocked(scheduleAudioClips)).not.toHaveBeenCalled();
            expect(vi.mocked(applyVcaGains)).not.toHaveBeenCalled();
            expect(vi.mocked(applyAutomation)).not.toHaveBeenCalled();
            expect(vi.mocked(scheduleAdjustmentLayers)).not.toHaveBeenCalled();
        }
    );
});
