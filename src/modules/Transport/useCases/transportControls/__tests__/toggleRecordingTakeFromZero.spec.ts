import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { recordingLifecycle } from '../recordingLifecycle';
import { toggleRecording } from '../toggleRecording';

type TestRecordingBuffer = {
    duration: number;
};

type TestRecordingClip = {
    id: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    audioBufferId?: string;
    audioOffsetBeats?: number;
};

type TestTrack = {
    id: string;
    kind: 'audio' | 'midi' | 'vca';
    armed: boolean;
};

type TestTrackState = {
    tracks: TestTrack[];
};

type TestRecordingResult = { kind: 'completed'; buffer: TestRecordingBuffer } | { kind: 'failed'; reason: string };

type StartAudioRecording = (trackId: string, callback: (result: TestRecordingResult) => void) => Promise<boolean>;

const mocks = vi.hoisted(() => {
    const timeSignatureMapStore: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
    const tempoMapStore: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
    return {
        tempoMapStore,
        scheduleClick: vi.fn<(...args: unknown[]) => void>(),
        resumeEngine: vi.fn<() => Promise<void>>(),
        notifyUser: vi.fn<(...args: unknown[]) => void>(),
        ensureTrackStrips: vi.fn<() => void>(),
        getAudioContext: vi.fn<() => { currentTime: number; baseLatency: number; outputLatency: number }>(),
        getTrackStoreState: vi.fn<() => TestTrackState | null>(() => ({ tracks: [] })),
        commitRecording: vi.fn<(clip: TestRecordingClip) => Promise<void>>(() => Promise.resolve()),
        discardRecording: vi.fn<(clipId: string) => boolean>(() => true),
        startRecording: vi.fn<(atBeat?: number) => TestRecordingClip[]>(() => []),
        startPlayback: vi.fn<() => Promise<void>>(),
        stopActiveRecording: vi.fn<() => Promise<void>>(),
        cacheAudioBuffer: vi.fn<(input: { buffer: TestRecordingBuffer; bufferId: string }) => string>(),
        startAudioRecording: vi.fn<StartAudioRecording>(),
        stopAudioRecording: vi.fn<() => Promise<void>>(),
        getCompensationDelay: vi.fn<(trackId: string) => number>(() => 0),
        timeSignatureMapStore,
        // The seek-during-count-in case imports the real `executePlayheadSeek`,
        // whose collaborators stay mocked here like every other side effect.
        stopAllScheduled: vi.fn<() => void>(),
        repositionNativeLiveGraphSession: vi.fn<() => Promise<unknown>>(),
        resetMidiState: vi.fn<() => void>(),
        startPlayheadScheduler: vi.fn<() => void>(),
        stopPlayheadScheduler: vi.fn<() => void>(),
        panicYeastRuntime: vi.fn<() => Promise<void>>(),
    };
});

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: mocks.timeSignatureMapStore,
}));
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: mocks.tempoMapStore,
}));

// Side-effecting collaborators of the count-in / recording paths.
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('../stopActiveRecording', () => ({
    stopActiveRecording: mocks.stopActiveRecording,
}));
vi.mock('../panicYeastRuntime', () => ({ panicYeastRuntime: mocks.panicYeastRuntime }));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: mocks.startPlayheadScheduler,
}));
vi.mock('../../playheadScheduler/stopPlayheadScheduler', () => ({
    stopPlayheadScheduler: mocks.stopPlayheadScheduler,
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
    commitRecording: mocks.commitRecording,
    startRecording: mocks.startRecording,
    discardRecording: mocks.discardRecording,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        setTransportInfo: vi.fn(),
    },
    resumeEngine: mocks.resumeEngine,
    getAudioContext: mocks.getAudioContext,
    scheduleClick: mocks.scheduleClick,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
    getCompensationDelay: mocks.getCompensationDelay,
    stopAllScheduled: mocks.stopAllScheduled,
    repositionNativeLiveGraphSession: mocks.repositionNativeLiveGraphSession,
}));
vi.mock('#/modules/MIDI/useCases', () => ({ resetMidiState: mocks.resetMidiState }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

// Audit #4591 — a take whose latency-compensated start would fall before
// beat 0 is clamped to beat 0 without trimming the buffer head, so the whole
// take plays late by the compensation it was supposed to receive.
describe('toggleRecording — take recorded from the top of the song', () => {
    // The count-in's boundary lives on the audio clock (the same clock the
    // clicks are scheduled on), so tests that exercise the armed start must
    // advance `currentTime` alongside the fake wall timers.
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        // resumeEngine returns Promise<void>; default to resolved so the `.catch`
        // chain in the count-in path has a thenable.
        mocks.resumeEngine.mockResolvedValue(undefined);
        mocks.startAudioRecording.mockResolvedValue(true);
        mocks.stopAudioRecording.mockResolvedValue(undefined);
        // `startPlayback` now resolves when the transport has actually rolled,
        // and the recording path waits on it; the default here is a roll that
        // costs nothing.
        mocks.startPlayback.mockResolvedValue(undefined);
        mocks.stopActiveRecording.mockImplementation(() => {
            recordingLifecycle.cancelPendingRecordingStart();
            const timerId = recordingLifecycle.countInTimerId;
            if (timerId !== null) {
                clearTimeout(timerId);
            }
            recordingLifecycle.setCountInTimerId(null);
            return Promise.resolve();
        });
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        audioClock.currentTime = 0;
        audioClock.baseLatency = 0;
        audioClock.outputLatency = 0;
        mocks.getAudioContext.mockReturnValue(audioClock);
        // clearAllMocks keeps return values, so a track snapshot an earlier test
        // installed would otherwise leak into every later one through the
        // recorder-start await.
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.timeSignatureMapStore.value = { changes: [] };
        mocks.tempoMapStore.value = { changes: [] };
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        vi.useRealTimers();
    });

    it('places the audio of a take recorded from beat 0 where it was played, not late by the latency', async () => {
        const recordingClip = {
            id: 'clip-recording',
            trackId: 'track-audio',
            startBeat: 0,
            endBeat: 0,
        };
        audioClock.currentTime = 10;
        audioClock.baseLatency = 0.01;
        audioClock.outputLatency = 0.03;
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: false,
            tempo: 120,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-audio', kind: 'audio', armed: true }],
        });
        mocks.startRecording.mockReturnValue([recordingClip]);

        toggleRecording();
        await vi.waitFor(() => expect(mocks.startRecording).toHaveBeenCalledOnce());

        const captured = mocks.startAudioRecording.mock.calls[0]?.[1];
        if (!captured) {
            throw new Error('Expected recording callback to be registered');
        }
        captured({ kind: 'completed', buffer: { duration: 2 } });
        await Promise.resolve();

        const clipUpdate = mocks.commitRecording.mock.calls[0]?.[0];
        if (!clipUpdate) {
            throw new Error('Expected the recording clip to be committed');
        }
        // 40 ms of latency at 120 BPM is 0.08 beats: the buffer's first sample
        // belongs 0.08 beats before the clip's media origin at beat 0, so the
        // media origin (startBeat - audioOffsetBeats) must sit at -0.08.
        const mediaOriginBeat = clipUpdate.startBeat - (clipUpdate.audioOffsetBeats ?? 0);
        expect(mediaOriginBeat).toBeCloseTo(-0.08, 9);
    });

    it('refuses a take shorter than its latency offset instead of committing an inverted clip', async () => {
        const recordingClip = {
            id: 'clip-recording',
            trackId: 'track-audio',
            startBeat: 0,
            endBeat: 0,
        };
        audioClock.currentTime = 10;
        audioClock.baseLatency = 0.01;
        audioClock.outputLatency = 0.03;
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: false,
            tempo: 120,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-audio', kind: 'audio', armed: true }],
        });
        mocks.startRecording.mockReturnValue([recordingClip]);
        mocks.getCompensationDelay.mockReturnValueOnce(0.24);

        toggleRecording();
        await vi.waitFor(() => expect(mocks.startRecording).toHaveBeenCalledOnce());

        const captured = mocks.startAudioRecording.mock.calls[0]?.[1];
        if (!captured) {
            throw new Error('Expected recording callback to be registered');
        }
        // The review's break: 0.1 s of capture against 0.28 s of offset
        // (10 ms base + 30 ms output + 240 ms compensation). The whole take
        // predates beat 0, so the computed end beat (-0.36) lands before the
        // clamped start beat (0). The take must be refused — no clip commit,
        // no cached buffer, the provisional clip (and with it the staged take
        // and its lane) discarded, and the user told — never an inverted
        // `endBeat < startBeat` clip committed.
        captured({ kind: 'completed', buffer: { duration: 0.1 } });
        await Promise.resolve();

        expect(mocks.commitRecording).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.discardRecording).toHaveBeenCalledWith('clip-recording');
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Recording discarded'), 'warning');
    });
});
