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
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: mocks.tempoMapStore,
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
        mocks.tempoMapStore.value = { changes: [] };
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

    it('should count in at the tempo the tempo map gives the record point, not the base tempo', () => {
        // Base tempo 120, but the map halves it to 60 exactly where recording
        // begins. The count-in has to hand the musician the pulse the recording
        // will keep, so its beats are one second apart, not half a second.
        mocks.tempoMapStore.value = {
            changes: [{ id: 'tempo-1', beat: 8, tempo: 60, curve: 'instant' }],
        };
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 1,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            playheadPosition: 8,
        });

        toggleRecording();

        expect(mocks.scheduleClick.mock.calls.map((call) => call[0])).toEqual([0, 1, 2, 3]);
        // The count-in lasts a full four seconds; the base tempo gave two.
        vi.advanceTimersByTime(3999);
        expect(mocks.startRecording).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(mocks.startRecording).toHaveBeenCalled();
    });

    it('should count a compound meter in its own beat unit rather than in quarter notes', () => {
        // 6/8 at 120 BPM: six eighth notes span three quarter notes, so the bar
        // lasts 1.5 s and each click is 0.25 s apart. Reading the numerator as a
        // count of quarter notes stretched the count-in to 3 s — a bar and a half
        // of the music it was counting in.
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 1,
            tempo: 120,
            timeSignatureNumerator: 6,
            timeSignatureDenominator: 8,
            playheadPosition: 0,
        });

        toggleRecording();

        expect(mocks.scheduleClick.mock.calls.map((call) => call[0])).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
        // Only the bar's first beat is accented.
        expect(mocks.scheduleClick.mock.calls.map((call) => call[1])).toEqual([
            true,
            false,
            false,
            false,
            false,
            false,
        ]);
        vi.advanceTimersByTime(1499);
        expect(mocks.startRecording).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(mocks.startRecording).toHaveBeenCalled();
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

    it('stops the active recording when toggled while already recording', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isRecording: true,
        });

        toggleRecording();

        expect(mocks.stopActiveRecording).toHaveBeenCalledOnce();
        // Does not attempt to arm a new recording.
        expect(mocks.startAudioRecording).not.toHaveBeenCalled();
    });

    it('punch-in rolls the transport and leaves the record window to the scheduler', async () => {
        // Was: "punch-in starts recording and playback even when no audio tracks
        // are armed". That is the defect in audit M-255 — a recording opened
        // here is anchored at the playhead rather than punchInBeat, and it makes
        // the scheduler's punch-in gate (`!isRecording`) fail, so its punch-out
        // branch never fires either. Record now arms the punch: the transport
        // rolls and the region governs both ends. See
        // `punchRecordArming.spec.ts` for the negatives that keep this from
        // degenerating into "punch enabled means never record".
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            punchInEnabled: true,
            punchInBeat: 4,
            punchOutBeat: 12,
            countInEnabled: false,
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        toggleRecording();

        await vi.waitFor(() => {
            expect(mocks.startPlayback).toHaveBeenCalledOnce();
        });
        expect(mocks.startAudioRecording).not.toHaveBeenCalled();
        expect(mocks.startRecording).not.toHaveBeenCalled();
        expect(updateTransportState).not.toHaveBeenCalledWith({ isRecording: true });
    });

    it('count-in uses safe defaults when the time-sig store and metronome volume are absent', () => {
        // A null time-sig store must fall back to an empty change list (flat meter),
        // and a null metronome volume must fall back to 0.5 — otherwise the count-in
        // would schedule nothing or click silently.
        mocks.timeSignatureMapStore.value = null;
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: false,
            countInEnabled: true,
            countInBars: 1,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            playheadPosition: 0,
            metronomeVolume: null as unknown as number,
        });

        toggleRecording();

        // 1 bar * 4 beats/bar = 4 clicks, each at the safe 0.5 volume.
        expect(mocks.scheduleClick).toHaveBeenCalledTimes(4);
        for (const call of mocks.scheduleClick.mock.calls) {
            expect(call[2]).toBe(0.5);
        }
    });

    it('records even when the track store snapshot is null', async () => {
        // A null track store must degrade to an empty armed list (?? []) rather
        // than throwing on the optional-chain; recording still proceeds.
        // Punch is off here: this case is about the null store, and an armed
        // punch region now hands the record window to the scheduler (M-255).
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
            punchInEnabled: false,
            countInEnabled: false,
        });
        mocks.getTrackStoreState.mockReturnValue(null);

        toggleRecording();

        await vi.waitFor(() => {
            expect(mocks.startRecording).toHaveBeenCalledOnce();
        });
        expect(updateTransportState).toHaveBeenCalledWith({ isRecording: true });
    });

    it('ignores a recorder callback that fires before the record clip is assigned', async () => {
        // The buffer-ready callback can race ahead of startRecording() populating
        // the clip list. The `if (recClip)` guard must keep it a no-op rather than
        // caching a buffer for a clip that does not exist yet. Punch off: this
        // case is about the callback race, not the punch region (M-255).
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
            punchInEnabled: false,
            countInEnabled: false,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-audio', kind: 'audio', armed: true }],
        });
        mocks.startAudioRecording.mockReturnValueOnce(
            // Resolve immediately so beginActualRecording proceeds, but the
            // buffer-ready callback is invoked before startRecording() populates clips.
            Promise.resolve(true)
        );

        toggleRecording();
        await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledOnce());

        // clips is assigned only after startRecording(); invoke the captured
        // callback while it is still the initial empty list.
        const captured = mocks.startAudioRecording.mock.calls[0]?.[1];
        if (!captured) {
            throw new Error('Expected recording callback to be registered');
        }
        captured({ duration: 2 });

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('falls back to 120 bpm in the recorder callback when the transport snapshot is null', async () => {
        // The transport tempo at buffer-commit time is read fresh. If the snapshot
        // is null, the `?? 120` fallback must drive the sample->beat conversion.
        // Tempo 60 would yield endBeat 12; the 120 fallback yields endBeat 14,
        // so asserting 14 proves the null-transport fallback was used.
        const recordingClip = {
            id: 'clip-recording',
            trackId: 'track-audio',
            startBeat: 10,
            endBeat: 10,
        };
        // Punch off: this case is about the tempo fallback, not the punch
        // region (M-255).
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            tempo: 60,
            isPlaying: true,
            isRecording: false,
            punchInEnabled: false,
            countInEnabled: false,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-audio', kind: 'audio', armed: true }],
        });
        mocks.startRecording.mockReturnValue([recordingClip]);

        toggleRecording();
        await vi.waitFor(() => expect(mocks.startRecording).toHaveBeenCalledOnce());

        // Now null the transport snapshot so the callback reads the 120 fallback.
        vi.mocked(getTransportState).mockReturnValue(null);

        const captured = mocks.startAudioRecording.mock.calls[0]?.[1];
        if (!captured) {
            throw new Error('Expected recording callback to be registered');
        }
        captured({ duration: 2 });
        await Promise.resolve();

        const clipUpdate = mocks.updateClip.mock.calls[0]?.[1];
        if (!clipUpdate) {
            throw new Error('Expected recording clip to be updated');
        }
        // durationBeats = 2 * (120/60) = 4 -> endBeat 14 (not 12 from tempo 60).
        expect(clipUpdate(recordingClip).endBeat).toBe(14);
    });
});
