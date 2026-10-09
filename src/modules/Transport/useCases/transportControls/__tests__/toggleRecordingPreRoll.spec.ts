import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getTempoAtBeat, secondsBetweenBeats, type TempoChange } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { scheduleAudioClips } from '../../scheduling/scheduleAudioClips';
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

type StartSource = (when: number, offset: number, duration: number) => void;

type AudioClock = {
    currentTime: number;
    baseLatency: number;
    outputLatency: number;
    createGain: () => unknown;
};

const mocks = vi.hoisted(() => ({
    resumeEngine: vi.fn<() => Promise<void>>(),
    notifyUser: vi.fn<(...args: unknown[]) => void>(),
    ensureTrackStrips: vi.fn<() => void>(),
    getAudioContext: vi.fn<() => AudioClock>(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; kind: 'audio'; armed: boolean }[] }>(),
    commitRecording: vi.fn<(clip: TestRecordingClip) => Promise<void>>(() => Promise.resolve()),
    discardRecording: vi.fn<(clipId: string) => boolean>(() => true),
    startRecording: vi.fn<(atBeat?: number) => TestRecordingClip[]>(),
    stopRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    startNativeLiveGraphSession: vi.fn<() => Promise<unknown>>(),
    startAudioRecording: vi.fn<StartAudioRecording>(),
    startPlayheadScheduler: vi.fn<() => void>(),
    scheduleClick: vi.fn<(...args: unknown[]) => void>(),
    startSource: vi.fn<StartSource>(),
    resolveClipsWithComping: vi.fn<(trackId: string, clips: unknown[]) => unknown[]>(() => []),
}));

vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: () => {
        mocks.startPlayheadScheduler();
        playheadClockRef.beat = transportStore.value!.playheadPosition;
        playheadClockRef.audioTimeSeconds = mocks.getAudioContext().currentTime;
    },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: mocks.resolveClipsWithComping,
    getTrackStoreState: mocks.getTrackStoreState,
    commitRecording: mocks.commitRecording,
    startRecording: mocks.startRecording,
    stopRecording: mocks.stopRecording,
    discardRecording: mocks.discardRecording,
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: () => ({ acceptsRecording: true }),
    getGainEnvelopeSeries: () => undefined,
    trackStore: {
        value: {
            tracks: [
                {
                    id: 'track-audio',
                    kind: 'audio',
                    muted: false,
                    sends: [],
                    clips: [],
                    freezeState: { status: 'active', frozenBufferId: null },
                },
            ],
        },
    },
}));
vi.mock('#/modules/Collaboration/stores', () => ({ collaborationStore: { value: null } }));
vi.mock('#/modules/Collaboration/useCases', () => ({ getAssetTransfer: () => null }));
vi.mock('../../scheduling/scheduleFrozenTrack', () => ({ scheduleFrozenTrack: () => false }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: mocks.resumeEngine,
    getAudioContext: mocks.getAudioContext,
    scheduleClick: mocks.scheduleClick,
    cacheAudioBuffer: vi.fn(),
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: vi.fn(() => Promise.resolve()),
    getCompensationDelay: () => 0,
    ensureTrackStrip: () => ({ gainNode: { connect: vi.fn() } }),
    getCurrentTime: () => 0,
    createBufferSource: () => ({
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start: mocks.startSource,
        onended: null,
    }),
    getCachedAudioBuffer: () => ({ duration: 10 }),
    nativeLiveGraphSessionOffered: () => false,
    startNativeLiveGraphSession: mocks.startNativeLiveGraphSession,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const audioClock: AudioClock = {
    currentTime: 0,
    baseLatency: 0.02,
    outputLatency: 0,
    createGain: () => ({
        gain: {
            value: 1,
            cancelScheduledValues: vi.fn(),
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
    }),
};
const RECORD_POINT_BEAT = 16;
const BASE_LATENCY_SEC = 0.02;
const BEATS_PER_SECOND_AT_120 = 2;
const LATENCY_BEATS = BASE_LATENCY_SEC * BEATS_PER_SECOND_AT_120;
const BASE_TEMPO_BPM = 120;

function instantTempoChanges(points: readonly (readonly [beat: number, tempo: number])[]): TempoChange[] {
    return points.map(([beat, tempo]) => ({ id: `tempo-${beat}`, beat, tempo, curve: 'instant' }));
}

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
        // The count-in route is taken: its bar of clicks is scheduled and neither
        // the capture nor the take has opened before the boundary is reached.
        expect(mocks.scheduleClick).toHaveBeenCalledTimes(4);
        expect(mocks.startAudioRecording).not.toHaveBeenCalled();
        expect(mocks.startRecording).not.toHaveBeenCalled();
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
        mocks.resolveClipsWithComping.mockReturnValue([]);
        mocks.resumeEngine.mockResolvedValue(undefined);
        mocks.startAudioRecording.mockResolvedValue(true);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        audioClock.currentTime = 0;
        audioClock.baseLatency = BASE_LATENCY_SEC;
        mocks.getAudioContext.mockReturnValue(audioClock);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-audio', kind: 'audio', armed: true }] });
        timeSignatureMapStore.set({ changes: [] });
        tempoMapStore.set({ changes: [] });
        playheadPositionRef.current = RECORD_POINT_BEAT;
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
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

        // The take opens on the boundary beat the count-in counted to, not on a default.
        expect(mocks.startRecording).toHaveBeenCalledExactlyOnceWith(RECORD_POINT_BEAT, expect.any(Function));

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

    it('rolls the take in from the meter-aware pre-roll start when the meter changes inside the pre-roll', async () => {
        // From beat 4 the meter is 3/4, so the two bars before beat 16 are
        // beats 10-13 and 13-16: the transport rolls from beat 10, not from the
        // beat 8 that two bars of the project's 4/4 default would name.
        timeSignatureMapStore.set({
            changes: [{ id: 'meter-3-4', beat: 4, numerator: 3, denominator: 4 }],
        });

        const committed = await recordTakeFromStoppedTransport({ preRollEnabled: true, takeSeconds: 10 });

        const rolledFromBeat = playheadPositionRef.current;
        expect(rolledFromBeat).toBe(10);
        const mediaOriginBeat = committed.startBeat - (committed.audioOffsetBeats ?? 0);
        expect(mediaOriginBeat).toBeCloseTo(rolledFromBeat - LATENCY_BEATS, 9);
        expect(mediaOriginBeat).toBeCloseTo(9.96, 9);
        expect(committed.startBeat).toBeCloseTo(RECORD_POINT_BEAT, 9);
    });

    // The transport rolls from beat 8 (two 4/4 bars before beat 16) and the
    // capture's first sample is 0.02 s earlier on the timeline, so the
    // record-point downbeat sits `seconds(8 -> 16) + 0.02 s` into the buffer.
    // The figure is wall-clock seconds through the map, so it differs per map
    // while the committed `startBeat` stays the record point.
    it.each([
        { name: 'no tempo map', points: [], seekSeconds: 4 + BASE_LATENCY_SEC },
        {
            name: 'a slowdown to 60 BPM two beats before the record point',
            points: [
                [0, 120],
                [14, 60],
            ] as const,
            seekSeconds: 3 + 2 + BASE_LATENCY_SEC,
        },
        {
            name: 'a change to 90 BPM exactly on the record point',
            points: [
                [0, 120],
                [16, 90],
            ] as const,
            seekSeconds: 4 + BASE_LATENCY_SEC,
        },
        {
            name: 'a speed-up to 180 BPM inside the pre-roll',
            points: [
                [0, 120],
                [12, 180],
            ] as const,
            seekSeconds: 2 + 4 / 3 + BASE_LATENCY_SEC,
        },
    ])('seeks the file to the record-point downbeat under $name', async ({ points, seekSeconds }) => {
        const changes = instantTempoChanges(points);
        tempoMapStore.set({ changes });

        const committed = await recordTakeFromStoppedTransport({ preRollEnabled: true, takeSeconds: 10 });

        expect(committed.startBeat).toBeCloseTo(RECORD_POINT_BEAT, 9);

        // The live reader: `scheduleAudioClips` hands the file offset to
        // `source.start`, converting `audioOffsetBeats` at the one tempo that
        // governs the clip's start beat and never integrating the map.
        mocks.resolveClipsWithComping.mockReturnValue([
            {
                ...committed,
                name: 'Take',
                type: 'audio',
                muted: false,
                regionStartBeat: committed.startBeat,
                regionEndBeat: committed.endBeat,
                stretchMode: 'off',
                stretchRatio: 1,
                loopEnabled: false,
                loopLength: undefined,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
            },
        ]);
        scheduleAudioClips(0, 1000, 0, new Set(), new Set(), [], { ...defaultTransportState, tempo: BASE_TEMPO_BPM });

        expect(mocks.startSource).toHaveBeenCalledOnce();
        const [, seekOffsetSec] = mocks.startSource.mock.calls[0]!;
        const rolledFromBeat = 8;
        const captureOriginSec = secondsBetweenBeats(changes, 0, rolledFromBeat, BASE_TEMPO_BPM) - BASE_LATENCY_SEC;
        const downbeatSec = secondsBetweenBeats(changes, 0, RECORD_POINT_BEAT, BASE_TEMPO_BPM);
        expect(seekOffsetSec).toBeCloseTo(seekSeconds, 3);
        expect(seekOffsetSec).toBeCloseTo(downbeatSec - captureOriginSec, 3);

        // `projectOfflineAudioClipPlaybacks` (AudioEngine, not importable from a
        // Transport spec) states the same law for the bounce: offset beats at the
        // flat start-beat tempo, with no map integration inside the span.
        const offlineSeekSec =
            (committed.audioOffsetBeats ?? 0) * (60 / getTempoAtBeat(changes, committed.startBeat, BASE_TEMPO_BPM));
        expect(offlineSeekSec).toBeCloseTo(seekSeconds, 3);
    });
});
