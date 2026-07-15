import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { scheduleAdjustmentLayers } from '#/modules/AudioEngine/useCases/adjustmentLayer/scheduleAdjustmentLayers';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { startAutomationRecording } from '#/modules/Automation/useCases/automationRecording/startAutomationRecording';
import { stopAutomationRecording } from '#/modules/Automation/useCases/automationRecording/stopAutomationRecording';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { applyAutomation } from '../scheduling/applyAutomation/applyAutomation';
import { applyVcaGains } from '../scheduling/applyAutomation/applyVcaGains';
import { disposeAudioClipScheduling } from '../scheduling/disposeAudioClipScheduling';
import { scheduleAudioClips } from '../scheduling/scheduleAudioClips';
import { scheduleMidiNotes } from '../scheduling/scheduleMidiNotes';
import { startPlayheadScheduler } from '../startPlayheadScheduler';
import { stopPlayheadScheduler } from '../stopPlayheadScheduler';

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

type StartAudioRecordingMock = (trackId: string, onComplete: (buffer: AudioBuffer) => void) => void;

type CacheAudioBufferMock = (input: { buffer: AudioBuffer; bufferId?: string }) => string;

// Shared mutable test state, hoisted so the vi.mock factories below can close
// over it (vi.mock factories are hoisted above imports).
const harness = vi.hoisted(() => ({
    clock: 0,
    cache_audio_buffer: vi.fn<CacheAudioBufferMock>(({ bufferId }) => bufferId ?? 'generated-test-buffer'),
    setTransportInfo: vi.fn(),
    start_audio_recording: vi.fn<StartAudioRecordingMock>(),
    start_recording: vi.fn<() => TestRecordingClip[]>(() => []),
    workers: [] as FakeWorker[],
    track_store: { value: { tracks: [] as { id: string; kind: 'audio' | 'midi'; armed: boolean }[] } },
    update_clip: vi.fn<UpdateClipMock>(),
}));

vi.mock('../../stores/transportStore', () => ({
    transportStore: { value: null, set: vi.fn() },
}));
vi.mock('../../stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));
vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: harness.track_store,
}));
vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: { value: { lanes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases/comping/addTakeLane', () => ({ addTakeLane: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases/comping/addTake', () => ({ addTake: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases/recording/startRecording', () => ({ startRecording: harness.start_recording }));
vi.mock('#/modules/Arrangement/useCases/recording/stopRecording', () => ({ stopRecording: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases/updateClip', () => ({ updateClip: harness.update_clip }));
vi.mock('../evaluateFollowActions', () => ({
    evaluateFollowActions: vi.fn(() => ({ jumpToPosition: null, shouldStop: false })),
}));
vi.mock('#/modules/AudioEngine/useCases/cacheAudioBuffer', () => ({ cacheAudioBuffer: harness.cache_audio_buffer }));
vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({ stopAllScheduled: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases/audioRecorder/startAudioRecording', () => ({
    startAudioRecording: harness.start_audio_recording,
}));
vi.mock('#/modules/AudioEngine/useCases/audioRecorder/stopAudioRecording', () => ({ stopAudioRecording: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases/engineAccess/getAudioContext', () => ({
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
}));
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
vi.mock('#/modules/Automation/useCases/automationRecording/startAutomationRecording', () => ({
    startAutomationRecording: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases/automationRecording/stopAutomationRecording', () => ({
    stopAutomationRecording: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases/modulation/applyModulation', () => ({
    applyModulation: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases/modulation/applyModulationToEngine', () => ({
    applyModulationToEngine: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/adjustmentLayer/scheduleAdjustmentLayers', () => ({
    scheduleAdjustmentLayers: vi.fn(),
}));
vi.mock('../scheduling/scheduleMidiNotes', () => ({
    scheduleMidiNotes: vi.fn(() => Promise.resolve()),
    scheduleFrozenTrack: vi.fn(() => false),
}));

// Stub the Worker the scheduler creates so we can capture its message handler
// and drive ticks synchronously instead of relying on a real worker thread.
const OriginalWorker = globalThis.Worker;
beforeEach(() => {
    harness.clock = 0;
    harness.workers = [];
    class WorkerStub {
        onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        constructor() {
            harness.workers.push(this as unknown as FakeWorker);
        }
    }
    globalThis.Worker = WorkerStub as unknown as typeof Worker;
});
afterEach(() => {
    globalThis.Worker = OriginalWorker;
});

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
    worker.onmessage?.({ data: { type: 'tick' } } as MessageEvent<unknown>);
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
        transportStore.value = null;
    });

    it('does not start automation recording when transport state is missing', () => {
        startPlayheadScheduler();

        expect(startAutomationRecording).not.toHaveBeenCalled();
    });
});

describe('stopPlayheadScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
        tempoMapStore.value = { changes: [] };
        transportStore.value = { ...playingTransport };
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
        tempoMapStore.value = { changes: [{ id: 't1', beat: 0, tempo: 90, curve: 'instant' }] };
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
        transportStore.value = { ...playingTransport, loopStart: 2, loopEnd: 6 };
        harness.clock = 0.1;
        await fireTick();

        expect(vi.mocked(stopAllScheduled).mock.calls.length).toBeGreaterThan(stopCallsBefore);
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
        transportStore.value = {
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

    it('disposePlayheadScheduler terminates the worker and clears the audio-clip pool (regression: §B fix 5)', async () => {
        startPlayheadScheduler();
        const worker = harness.workers[harness.workers.length - 1]!;

        harness.clock = 0.05;
        await fireTick();

        disposePlayheadScheduler();

        expect(vi.mocked(worker.terminate)).toHaveBeenCalled();
        expect(vi.mocked(disposeAudioClipScheduling)).toHaveBeenCalled();
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
        worker.onmessage?.({ data: { type: 'tick' } } as MessageEvent<unknown>);
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
        worker.onmessage?.({ data: { type: 'tick' } } as MessageEvent<unknown>);
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
            worker.onmessage?.({ data: { type: 'tick' } } as MessageEvent<unknown>);
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
