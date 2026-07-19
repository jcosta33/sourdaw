import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
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
};

type TestTrack = {
    id: string;
    kind: 'audio' | 'midi';
    armed: boolean;
};

type TestTrackState = {
    tracks: TestTrack[];
};

type StartAudioRecording = (trackId: string, callback: (buffer: TestRecordingBuffer) => void) => Promise<boolean>;

const mocks = vi.hoisted(() => {
    const timeSignatureMapStore: { value: { changes: unknown[] } } = { value: { changes: [] } };
    return {
        scheduleClick: vi.fn<(...args: unknown[]) => void>(),
        resumeEngine: vi.fn<() => Promise<void>>(),
        notifyUser: vi.fn<(...args: unknown[]) => void>(),
        ensureTrackStrips: vi.fn<() => void>(),
        getAudioContext: vi.fn<() => { currentTime: number; baseLatency: number; outputLatency: number }>(),
        getTrackStoreState: vi.fn<() => TestTrackState | null>(() => ({ tracks: [] })),
        updateClip: vi.fn<(clipId: string, updater: (clip: TestRecordingClip) => TestRecordingClip) => void>(),
        startRecording: vi.fn<() => TestRecordingClip[]>(() => []),
        startPlayback: vi.fn<() => void>(),
        stopActiveRecording: vi.fn<() => Promise<void>>(),
        cacheAudioBuffer: vi.fn<(input: { buffer: TestRecordingBuffer; bufferId: string }) => string>(),
        startAudioRecording: vi.fn<StartAudioRecording>(),
        stopAudioRecording: vi.fn<() => Promise<void>>(),
        getCompensationDelay: vi.fn<(trackId: string) => number>(() => 0),
        timeSignatureMapStore,
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

// Side-effecting collaborators of the count-in / recording paths.
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('../stopActiveRecording', () => ({
    stopActiveRecording: mocks.stopActiveRecording,
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
    updateClip: mocks.updateClip,
    startRecording: mocks.startRecording,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: mocks.resumeEngine,
    getAudioContext: mocks.getAudioContext,
    scheduleClick: mocks.scheduleClick,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
    getCompensationDelay: mocks.getCompensationDelay,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

describe('toggleRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        // resumeEngine returns Promise<void>; default to resolved so the `.catch`
        // chain in the count-in path has a thenable.
        mocks.resumeEngine.mockResolvedValue(undefined);
        mocks.startAudioRecording.mockResolvedValue(true);
        mocks.stopAudioRecording.mockResolvedValue(undefined);
        mocks.stopActiveRecording.mockImplementation(() => {
            recordingLifecycle.cancelPendingRecordingStart();
            recordingLifecycle.setCountInTimerId(null);
            return Promise.resolve();
        });
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        mocks.getAudioContext.mockReturnValue({ currentTime: 0, baseLatency: 0, outputLatency: 0 });
        mocks.timeSignatureMapStore.value = { changes: [] };
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        vi.useRealTimers();
    });

    it('should not change transport when state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleRecording();

        expect(update).not.toHaveBeenCalled();
    });

    it('should count in using the resolved meter at the playhead, not the flat numerator', () => {
        // Flat numerator is 4, but a 3/4 change lands at the record point (beat 12).
        mocks.timeSignatureMapStore.value = {
            changes: [{ id: 'ts-1', beat: 12, numerator: 3, denominator: 4 }],
        };
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 2,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            playheadPosition: 12,
        });

        toggleRecording();

        // 2 bars * 3 beats/bar (resolved at beat 12) = 6 clicks, not 8.
        expect(mocks.scheduleClick).toHaveBeenCalledTimes(6);
    });

    it('surfaces a failed engine resume during count-in instead of swallowing it', async () => {
        // The microtask-based `.catch` needs real timers to flush.
        vi.useRealTimers();
        mocks.resumeEngine.mockRejectedValue(new Error('resume blocked'));
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 1,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            playheadPosition: 0,
        });

        toggleRecording();

        // Count-in clicks are still scheduled (resume is best-effort), but the
        // rejection is no longer dropped — the user is warned to re-arm.
        expect(mocks.scheduleClick).toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('suspended'), 'warning');
        });
    });

    it('should fall back to the flat numerator when there is no time-sig change at the playhead', () => {
        mocks.timeSignatureMapStore.value = { changes: [] };
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 1,
            timeSignatureNumerator: 5,
            timeSignatureDenominator: 4,
            playheadPosition: 0,
        });

        toggleRecording();

        // 1 bar * 5 beats/bar = 5 clicks.
        expect(mocks.scheduleClick).toHaveBeenCalledTimes(5);
    });

    it('should cache recorded audio through the AudioEngine use case with a generated recording id', async () => {
        const recording_clip = {
            id: 'clip-recording',
            trackId: 'track-audio',
            startBeat: 10,
            endBeat: 10,
        };
        const recorded_buffer = { duration: 2 };
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
        mocks.startRecording.mockReturnValue([recording_clip]);

        toggleRecording();

        await vi.waitFor(() => {
            expect(mocks.startRecording).toHaveBeenCalledOnce();
        });

        const recording_callback = mocks.startAudioRecording.mock.calls[0]?.[1];
        if (!recording_callback) {
            throw new Error('Expected recording callback to be registered');
        }

        recording_callback(recorded_buffer);

        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({
            buffer: recorded_buffer,
            bufferId: expect.stringMatching(/^rec-/),
        });

        const cached_buffer_id = mocks.cacheAudioBuffer.mock.calls[0]?.[0].bufferId;
        if (!cached_buffer_id) {
            throw new Error('Expected recording buffer id to be cached');
        }

        await Promise.resolve();

        const clip_update = mocks.updateClip.mock.calls[0]?.[1];
        if (!clip_update) {
            throw new Error('Expected recording clip to be updated');
        }

        expect(clip_update(recording_clip)).toEqual({
            ...recording_clip,
            audioBufferId: cached_buffer_id,
            startBeat: 10,
            endBeat: 14,
        });
    });

    it('does not create recording state when an audio recorder cannot start', async () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: false,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-audio', kind: 'audio', armed: true }],
        });
        mocks.startAudioRecording.mockResolvedValueOnce(false);

        toggleRecording();

        await vi.waitFor(() => {
            expect(mocks.stopAudioRecording).toHaveBeenCalledOnce();
        });
        expect(mocks.startRecording).not.toHaveBeenCalled();
        expect(updateTransportState).not.toHaveBeenCalledWith({ isRecording: true });
        expect(mocks.startPlayback).not.toHaveBeenCalled();
    });

    it('cancels a pending recorder start when recording is toggled again', async () => {
        let finishStart: ((started: boolean) => void) | undefined;
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: false,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-audio', kind: 'audio', armed: true }],
        });
        mocks.startAudioRecording.mockReturnValueOnce(
            new Promise<boolean>((resolve) => {
                finishStart = resolve;
            })
        );

        toggleRecording();
        await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledOnce());
        toggleRecording();

        expect(mocks.stopActiveRecording).toHaveBeenCalledOnce();
        expect(mocks.startAudioRecording).toHaveBeenCalledOnce();

        const finish = finishStart;
        if (!finish) {
            throw new Error('Expected recording start to be pending');
        }
        finish(true);
        await Promise.resolve();

        expect(mocks.startRecording).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.stringContaining('Unable to start'), 'error');
    });
});
