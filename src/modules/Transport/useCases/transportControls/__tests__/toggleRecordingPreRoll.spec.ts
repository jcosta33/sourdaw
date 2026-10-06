import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { recordingLifecycle } from '../recordingLifecycle';
import { toggleRecording } from '../toggleRecording';

type TestRecordingClip = {
    id: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    audioBufferId?: string;
    audioOffsetBeats?: number;
};

type TestRecordingResult = { kind: 'completed'; buffer: { duration: number } } | { kind: 'failed'; reason: string };

type StartAudioRecording = (trackId: string, callback: (result: TestRecordingResult) => void) => Promise<boolean>;

const mocks = vi.hoisted(() => ({
    resumeEngine: vi.fn<() => Promise<void>>(),
    notifyUser: vi.fn<(...args: unknown[]) => void>(),
    ensureTrackStrips: vi.fn<() => void>(),
    getAudioContext: vi.fn<() => { currentTime: number; baseLatency: number; outputLatency: number }>(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; kind: 'audio'; armed: boolean }[] }>(),
    commitRecording: vi.fn<(clip: TestRecordingClip) => Promise<void>>(() => Promise.resolve()),
    discardRecording: vi.fn<(clipId: string) => boolean>(() => true),
    startRecording: vi.fn<(atBeat?: number) => TestRecordingClip[]>(),
    stopRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    startNativeLiveGraphSession: vi.fn<() => Promise<unknown>>(),
    startAudioRecording: vi.fn<StartAudioRecording>(),
    startPlayheadScheduler: vi.fn<() => void>(),
}));

vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: mocks.startPlayheadScheduler,
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
    commitRecording: mocks.commitRecording,
    startRecording: mocks.startRecording,
    stopRecording: mocks.stopRecording,
    discardRecording: mocks.discardRecording,
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: () => ({ acceptsRecording: true }),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: mocks.resumeEngine,
    getAudioContext: mocks.getAudioContext,
    scheduleClick: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: vi.fn(() => Promise.resolve()),
    getCompensationDelay: () => 0,
    nativeLiveGraphSessionOffered: () => false,
    startNativeLiveGraphSession: mocks.startNativeLiveGraphSession,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const audioClock = { currentTime: 0, baseLatency: 0.02, outputLatency: 0 };
const RECORD_POINT_BEAT = 16;
const BASE_LATENCY_SEC = 0.02;
const BEATS_PER_SECOND_AT_120 = 2;
const LATENCY_BEATS = BASE_LATENCY_SEC * BEATS_PER_SECOND_AT_120;

async function recordTakeFromStoppedTransport(options: {
    preRollEnabled: boolean;
    takeSeconds: number;
    countInBars?: number;
}) {
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        playheadPosition: RECORD_POINT_BEAT,
        preRollEnabled: options.preRollEnabled,
        preRollBars: 2,
        countInEnabled: options.countInBars !== undefined,
        countInBars: options.countInBars ?? 0,
    });
    mocks.startRecording.mockImplementation((atBeat) => [
        {
            id: 'clip-recording',
            trackId: 'track-audio',
            startBeat: atBeat ?? RECORD_POINT_BEAT,
            endBeat: atBeat ?? RECORD_POINT_BEAT,
        },
    ]);

    toggleRecording();
    if (options.countInBars !== undefined) {
        // One 4/4 bar at 120 BPM is 2 s on the audio clock the count-in arms against.
        audioClock.currentTime = 2;
        await vi.advanceTimersByTimeAsync(2000);
    }
    await vi.waitFor(() => expect(mocks.startPlayheadScheduler).toHaveBeenCalledOnce());

    const finishCapture = mocks.startAudioRecording.mock.calls[0]?.[1];
    if (!finishCapture) {
        throw new Error('Expected the recording callback to be registered');
    }
    finishCapture({ kind: 'completed', buffer: { duration: options.takeSeconds } });
    await vi.waitFor(() => expect(mocks.commitRecording).toHaveBeenCalledOnce());

    const committed = mocks.commitRecording.mock.calls[0]?.[0];
    if (!committed) {
        throw new Error('Expected the take to be committed');
    }
    return committed;
}

describe('toggleRecording — take aligned to the timeline under pre-roll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resumeEngine.mockResolvedValue(undefined);
        mocks.startAudioRecording.mockResolvedValue(true);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        audioClock.currentTime = 0;
        audioClock.baseLatency = BASE_LATENCY_SEC;
        mocks.getAudioContext.mockReturnValue(audioClock);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-audio', kind: 'audio', armed: true }] });
        timeSignatureMapStore.set({ changes: [] });
        playheadPositionRef.current = RECORD_POINT_BEAT;
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
    });

    it('keeps the media origin at the roll start minus latency and trims the pre-roll head so the clip begins at the record point', async () => {
        // 2 bars of 4/4 pre-roll before beat 16 is 8 beats, 4 s at 120 BPM.
        const committed = await recordTakeFromStoppedTransport({ preRollEnabled: true, takeSeconds: 10 });

        const mediaOriginBeat = committed.startBeat - (committed.audioOffsetBeats ?? 0);
        expect(mediaOriginBeat).toBeCloseTo(RECORD_POINT_BEAT - 8 - LATENCY_BEATS, 9);
        expect(committed.startBeat).toBeCloseTo(RECORD_POINT_BEAT, 9);
        // A clap 4.02 s into the buffer — the beat-16 downbeat the musician
        // played to — sits at the media origin plus 4.02 s of timeline.
        expect(mediaOriginBeat + 4.02 * BEATS_PER_SECOND_AT_120).toBeCloseTo(RECORD_POINT_BEAT, 9);
        // The capture ran 10 s from the roll start; its end is unchanged by the trim.
        expect(committed.endBeat).toBeCloseTo(mediaOriginBeat + 10 * BEATS_PER_SECOND_AT_120, 9);
    });

    it('aligns a take armed through the count-in the same way', async () => {
        const committed = await recordTakeFromStoppedTransport({
            preRollEnabled: true,
            takeSeconds: 10,
            countInBars: 1,
        });

        const mediaOriginBeat = committed.startBeat - (committed.audioOffsetBeats ?? 0);
        expect(mediaOriginBeat).toBeCloseTo(RECORD_POINT_BEAT - 8 - LATENCY_BEATS, 9);
        expect(committed.startBeat).toBeCloseTo(RECORD_POINT_BEAT, 9);
    });

    it('places a take without pre-roll from the record point, rewound by latency only', async () => {
        const committed = await recordTakeFromStoppedTransport({ preRollEnabled: false, takeSeconds: 4 });

        expect(committed.startBeat).toBeCloseTo(RECORD_POINT_BEAT - LATENCY_BEATS, 9);
        expect(committed.audioOffsetBeats).toBeUndefined();
        expect(committed.endBeat).toBeCloseTo(RECORD_POINT_BEAT - LATENCY_BEATS + 4 * BEATS_PER_SECOND_AT_120, 9);
    });
});
