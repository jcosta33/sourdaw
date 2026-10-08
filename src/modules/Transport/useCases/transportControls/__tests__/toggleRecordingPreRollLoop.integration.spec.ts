import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, resolveClipsWithComping, stageRecordingTake } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { secondsBetweenBeats } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { recordingLifecycle } from '../recordingLifecycle';
import { toggleRecording } from '../toggleRecording';

type TestRecordingResult = { kind: 'completed'; buffer: { duration: number } } | { kind: 'failed'; reason: string };

type StartAudioRecording = (trackId: string, callback: (result: TestRecordingResult) => void) => Promise<boolean>;

const mocks = vi.hoisted(() => ({
    audioClock: { currentTime: 0, baseLatency: 0.02, outputLatency: 0 },
    startAudioRecording: vi.fn<StartAudioRecording>(),
    startPlayback: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

// The capture and the roll are the hardware's; everything the take becomes —
// the recorder, the passes, the commit, the comp — is production code. The
// Arrangement handler graph imports this barrel too, so the real module is
// spread and only the recording collaborators are replaced.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: () => mocks.audioClock,
    cacheAudioBuffer: vi.fn(),
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: vi.fn(() => Promise.resolve()),
    getCompensationDelay: () => 0,
}));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const TRACK_ID = 'track-audio';
const RECORD_POINT_BEAT = 12;
const LOOP_START_BEAT = 8;
const LOOP_END_BEAT = 16;
const TEMPO_BPM = 120;
/** Two bars of 4/4 pre-roll before beat 12 roll in from beat 4; 20 ms of latency precedes that. */
const MEDIA_ORIGIN_SECONDS = secondsBetweenBeats([], 0, 4, TEMPO_BPM) - 0.02;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/** Field-identical replica of Arrangement's TrackDummy fixture, as other
 *  modules' specs keep their own copy rather than deep-importing a foreign
 *  `__tests__` helper. */
function armedAudioTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'Audio',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

/** The capture position, in beats at the one tempo, of what was played at timeline `beat`. */
function capturedAt(beat: number): number {
    return ((secondsBetweenBeats([], 0, beat, TEMPO_BPM) - MEDIA_ORIGIN_SECONDS) * TEMPO_BPM) / 60;
}

function recordedClip(): Clip {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    if (!clip) {
        throw new Error('Expected the committed recording clip');
    }
    return clip;
}

/** The capture position the track sounds at timeline `beat`, or null where nothing plays. */
function soundingAt(beat: number): number | null {
    const fragment = resolveClipsWithComping(TRACK_ID, trackStore.value?.tracks[0]?.clips ?? []).find(
        (candidate) => candidate.startBeat <= beat && beat < candidate.endBeat
    );
    if (!fragment) {
        return null;
    }
    return beat - fragment.startBeat + (fragment.audioOffsetBeats ?? 0);
}

/**
 * Loop [8,16) recorded from beat 12 with two bars of pre-roll: the capture
 * opens at the roll start, the recorder opens the clip on the record point, and
 * the playhead scheduler stages one pass at each of two wraps exactly as it
 * mints them. The capture runs to beat 24.
 */
async function recordLoopWithPreRoll(): Promise<void> {
    toggleRecording();
    await vi.waitFor(() => expect(mocks.startPlayback).toHaveBeenCalledOnce());
    const provisional = recordedClip();
    expect(provisional.startBeat).toBe(RECORD_POINT_BEAT);
    for (const [name, sourceOffsetBeats] of [
        ['Take 2', 0],
        ['Take 3', 4],
    ] as const) {
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name,
            startBeat: LOOP_START_BEAT,
            endBeat: LOOP_END_BEAT,
            sourceOffsetBeats,
        });
    }
    const finishCapture = mocks.startAudioRecording.mock.calls[0]?.[1];
    if (!finishCapture) {
        throw new Error('Expected the recording callback to be registered');
    }
    finishCapture({
        kind: 'completed',
        buffer: { duration: secondsBetweenBeats([], 0, 24, TEMPO_BPM) - MEDIA_ORIGIN_SECONDS },
    });
    await vi.waitFor(() => expect(undoHistoryStore.value?.past).toHaveLength(1));
    flushAutomergeStorageWrites();
}

async function comp(takeName: string): Promise<void> {
    const take = takeLaneStore.value?.lanes[0]?.takes.find((candidate) => candidate.name === takeName);
    if (!take) {
        throw new Error(`Expected the ${takeName} pass`);
    }
    await executeAppAction({
        type: 'setCompRegion',
        payload: { trackId: TRACK_ID, takeId: take.id, startBeat: LOOP_START_BEAT, endBeat: LOOP_END_BEAT },
    });
    flushAutomergeStorageWrites();
}

describe('a loop recording begun inside the loop with pre-roll', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('pre-roll loop recording integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        vi.clearAllMocks();
        mocks.audioClock.currentTime = 0;
        mocks.startAudioRecording.mockResolvedValue(true);
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        transportStore.set({
            ...defaultTransportState,
            tempo: TEMPO_BPM,
            playheadPosition: RECORD_POINT_BEAT,
            isLooping: true,
            loopStart: LOOP_START_BEAT,
            loopEnd: LOOP_END_BEAT,
            preRollEnabled: true,
            preRollBars: 2,
            countInEnabled: false,
        });
        trackStore.set({
            tracks: [armedAudioTrack()],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        recordingLifecycle.cancelPendingRecordingStart();
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        transportStore.set(defaultTransportState);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('opens the clip at the loop start, entering the media where beat 8 was captured', async () => {
        await recordLoopWithPreRoll();

        expect(recordedClip().startBeat).toBe(LOOP_START_BEAT);
        expect(recordedClip().audioOffsetBeats).toBeCloseTo(capturedAt(LOOP_START_BEAT), 9);
    });

    it('lands the record-point downbeat on its beat', async () => {
        await recordLoopWithPreRoll();

        expect(soundingAt(RECORD_POINT_BEAT)).toBeCloseTo(capturedAt(RECORD_POINT_BEAT), 9);
        expect(soundingAt(20)).toBeCloseTo(capturedAt(20), 9);
    });

    it('plays pass 2 across the whole loop in time', async () => {
        await recordLoopWithPreRoll();
        await comp('Take 3');

        // Pass 2 was played over the second lap, beats 16–24 of the capture.
        expect(soundingAt(LOOP_START_BEAT)).toBeCloseTo(capturedAt(16), 9);
        expect(soundingAt(RECORD_POINT_BEAT)).toBeCloseTo(capturedAt(20), 9);
        expect(soundingAt(15.5)).toBeCloseTo(capturedAt(23.5), 9);
    });

    it('plays pass 1 from the record-point downbeat only', async () => {
        await recordLoopWithPreRoll();
        await comp('Take 2');

        expect(soundingAt(LOOP_START_BEAT)).toBeNull();
        expect(soundingAt(RECORD_POINT_BEAT)).toBeCloseTo(capturedAt(RECORD_POINT_BEAT), 9);
    });
});
