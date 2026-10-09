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
import { type AppAction } from '#/utils/handlerContract';

import { getTempoAtBeat, secondsBetweenBeats, type TempoChange } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { recordingLifecycle } from '../recordingLifecycle';
import { resolveRollStartBeat } from '../resolveRollStartBeat';
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
vi.mock('../startPlayback', () => ({
    startPlayback: async () => {
        await mocks.startPlayback();
        playheadClockRef.beat = resolveRollStartBeat(transportStore.value!, timeSignatureMapStore.value?.changes ?? []);
        playheadClockRef.audioTimeSeconds = mocks.audioClock.currentTime;
    },
}));
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

function openRecordingProject(): void {
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
}

function closeRecordingProject(): void {
    recordingLifecycle.cancelPendingRecordingStart();
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    tempoMapStore.set({ changes: [] });
    transportStore.set(defaultTransportState);
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
}

describe('a loop recording begun inside the loop with pre-roll', () => {
    beforeEach(openRecordingProject);
    afterEach(closeRecordingProject);

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

type TempoChangeScenario = {
    recordPointBeat: number;
    loop: readonly [startBeat: number, endBeat: number];
    preRollBars: number;
    tempoChanges: TempoChange[];
    /** How deep into the media the scheduler mints each pass, in unwrapped beats from the record point. */
    passDepths: readonly number[];
    captureSeconds: number;
};

function songSecondsAt(scenario: TempoChangeScenario, beat: number): number {
    return secondsBetweenBeats(scenario.tempoChanges, 0, beat, TEMPO_BPM);
}

/**
 * Record a loop across a tempo change exactly as in production: the transport
 * rolls from its pre-roll start (or the record point), the recorder opens the
 * clip, the scheduler stages a pass at each of two wraps, and the capture's
 * terminal commits it.
 */
async function recordLoopAcrossTempoChange(scenario: TempoChangeScenario): Promise<void> {
    const [loopStartBeat, loopEndBeat] = scenario.loop;
    tempoMapStore.set({ changes: scenario.tempoChanges });
    transportStore.set({
        ...defaultTransportState,
        tempo: TEMPO_BPM,
        playheadPosition: scenario.recordPointBeat,
        isLooping: true,
        loopStart: loopStartBeat,
        loopEnd: loopEndBeat,
        preRollEnabled: scenario.preRollBars > 0,
        preRollBars: scenario.preRollBars,
        countInEnabled: false,
    });
    toggleRecording();
    await vi.waitFor(() => expect(mocks.startPlayback).toHaveBeenCalledOnce());
    const provisional = recordedClip();
    for (const [index, sourceOffsetBeats] of scenario.passDepths.entries()) {
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: `Take ${index + 2}`,
            startBeat: loopStartBeat,
            endBeat: loopEndBeat,
            sourceOffsetBeats,
        });
    }
    const finishCapture = mocks.startAudioRecording.mock.calls[0]?.[1];
    if (!finishCapture) {
        throw new Error('Expected the recording callback to be registered');
    }
    finishCapture({ kind: 'completed', buffer: { duration: scenario.captureSeconds } });
    await vi.waitFor(() => expect(undoHistoryStore.value?.past).toHaveLength(1));
    flushAutomergeStorageWrites();
}

async function compLoop(
    scenario: TempoChangeScenario,
    takeName: string,
    region: readonly [startBeat: number, endBeat: number] = scenario.loop
): Promise<void> {
    const take = takeLaneStore.value?.lanes[0]?.takes.find((candidate) => candidate.name === takeName);
    if (!take) {
        throw new Error(`Expected the ${takeName} pass`);
    }
    await executeAppAction({
        type: 'setCompRegion',
        payload: { trackId: TRACK_ID, takeId: take.id, startBeat: region[0], endBeat: region[1] },
    });
    flushAutomergeStorageWrites();
}

/**
 * Seconds into the capture the track sounds at timeline `beat`, or null where
 * nothing plays. A reader enters a fragment's file at its offset converted at
 * the tempo of the fragment's first beat, then plays on in real time.
 */
function fileSecondsAt(scenario: TempoChangeScenario, beat: number): number | null {
    const fragment = resolveClipsWithComping(TRACK_ID, trackStore.value?.tracks[0]?.clips ?? []).find(
        (candidate) => candidate.startBeat <= beat && beat < candidate.endBeat
    );
    if (!fragment) {
        return null;
    }
    const entrySeconds =
        ((fragment.audioOffsetBeats ?? 0) * 60) / getTempoAtBeat(scenario.tempoChanges, fragment.startBeat, TEMPO_BPM);
    return entrySeconds + songSecondsAt(scenario, beat) - songSecondsAt(scenario, fragment.startBeat);
}

describe('a loop recording across a tempo change', () => {
    beforeEach(openRecordingProject);
    afterEach(closeRecordingProject);

    describe('run up from the drop to 60 BPM at beat 12, with one bar of pre-roll, into loop [16,24)', () => {
        const scenario: TempoChangeScenario = {
            recordPointBeat: 12,
            loop: [16, 24],
            preRollBars: 1,
            tempoChanges: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-12', beat: 12, tempo: 60, curve: 'instant' },
            ],
            // Pass 1 after the 4-beat run-up, pass 2 a loop later.
            passDepths: [4, 12],
            // Beats 8–12 at 120 BPM, then the run-up and two 8 s laps at 60 BPM.
            captureSeconds: 2 + 4 + 16 + 0.02,
        };
        /** The roll starts at beat 8, 4 s into the song; 20 ms of latency precede it. */
        const mediaOriginSeconds = 4 - 0.02;
        /** What lap `lap` of the loop captured on its beat `beat`, in seconds into the file. */
        const capturedOnLap = (beat: number, lap: number) =>
            songSecondsAt(scenario, beat) + lap * 8 - mediaOriginSeconds;

        it('plays pass 1 across the whole loop from what was captured there', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 2');

            expect(fileSecondsAt(scenario, 16)).toBeCloseTo(capturedOnLap(16, 0), 9);
            expect(fileSecondsAt(scenario, 17)).toBeCloseTo(capturedOnLap(17, 0), 9);
            expect(fileSecondsAt(scenario, 23.5)).toBeCloseTo(capturedOnLap(23.5, 0), 9);
        });

        it('plays pass 2 across the whole loop from what was captured a lap later', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 3');

            expect(fileSecondsAt(scenario, 16)).toBeCloseTo(capturedOnLap(16, 1), 9);
            expect(fileSecondsAt(scenario, 17)).toBeCloseTo(capturedOnLap(17, 1), 9);
            expect(fileSecondsAt(scenario, 23.5)).toBeCloseTo(capturedOnLap(23.5, 1), 9);
        });
    });

    describe('begun at beat 12 inside loop [8,16), the tempo dropping to 60 BPM at beat 10, no pre-roll', () => {
        const scenario: TempoChangeScenario = {
            recordPointBeat: 12,
            loop: [8, 16],
            preRollBars: 0,
            tempoChanges: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-10', beat: 10, tempo: 60, curve: 'instant' },
            ],
            // Pass 1 from the record point, pass 2 after its 4-beat lap, pass 3
            // a whole loop after that.
            passDepths: [0, 4, 12],
            // The short first lap (4 s) and three 7 s laps.
            captureSeconds: 4 + 21 + 0.02,
        };
        /** Beat 12 sounds 7 s into the song; 20 ms of latency precede the record point. */
        const mediaOriginSeconds = 7 - 0.02;
        /** One lap of [8,16): 1 s at 120 BPM, then 6 s at 60 BPM. */
        const lapSeconds = 7;
        const capturedOnLap = (beat: number, lap: number) =>
            songSecondsAt(scenario, beat) + lap * lapSeconds - mediaOriginSeconds;

        it('opens the clip at the loop start, entering the file where beat 8 sits before the capture', async () => {
            await recordLoopAcrossTempoChange(scenario);

            expect(recordedClip().startBeat).toBe(8);
            // Uncomped, the clip plays its own media: leading silence, then
            // the record point's downbeat on its beat.
            expect(fileSecondsAt(scenario, 8)).toBeCloseTo(capturedOnLap(8, 0), 9);
            expect(fileSecondsAt(scenario, 12)).toBeCloseTo(capturedOnLap(12, 0), 9);
        });

        it('plays pass 1 from the record point on its beat', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 2');

            expect(fileSecondsAt(scenario, 11.5)).toBeNull();
            expect(fileSecondsAt(scenario, 12)).toBeCloseTo(capturedOnLap(12, 0), 9);
            expect(fileSecondsAt(scenario, 15)).toBeCloseTo(capturedOnLap(15, 0), 9);
        });

        it('plays pass 2 across the whole loop from what was captured a lap later', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 3');

            expect(fileSecondsAt(scenario, 8)).toBeCloseTo(capturedOnLap(8, 1), 9);
            expect(fileSecondsAt(scenario, 12)).toBeCloseTo(capturedOnLap(12, 1), 9);
            expect(fileSecondsAt(scenario, 15.5)).toBeCloseTo(capturedOnLap(15.5, 1), 9);
        });

        it('plays pass 3 from what was captured two laps later, the whole loop walked through the tempo change', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 4');

            expect(fileSecondsAt(scenario, 8)).toBeCloseTo(capturedOnLap(8, 2), 9);
            expect(fileSecondsAt(scenario, 12)).toBeCloseTo(capturedOnLap(12, 2), 9);
        });

        it('fills the clip after a comp ending past the tempo change from what was captured there', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 3', [8, 12]);

            // The clip shows through from beat 12, entering its own media there.
            expect(fileSecondsAt(scenario, 12)).toBeCloseTo(capturedOnLap(12, 0), 9);
            expect(fileSecondsAt(scenario, 14)).toBeCloseTo(capturedOnLap(14, 0), 9);
        });

        it('enters a pass comped from after the tempo change at what was captured there', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 3', [12, 16]);

            expect(fileSecondsAt(scenario, 12)).toBeCloseTo(capturedOnLap(12, 1), 9);
            expect(fileSecondsAt(scenario, 15)).toBeCloseTo(capturedOnLap(15, 1), 9);
        });

        // Pass 1 is the clip's own material from the record point on, so once
        // the clip is slipped or moved, comping it must sound exactly what the
        // uncomped clip sounds there — silence where the content has not yet
        // reached the pass.
        it.each([
            {
                name: 'its content slipped a beat later into the media',
                edit: (clipId: string): AppAction => ({
                    type: 'slipClipContent',
                    payload: { clipId, clipType: 'audio', offset: -5.96 + 1 },
                }),
            },
            {
                name: 'the clip moved two beats earlier',
                edit: (clipId: string): AppAction => ({
                    type: 'moveClip',
                    payload: { clipId, trackId: TRACK_ID, startBeat: 6 },
                }),
            },
        ])('plays pass 1 with the clip’s own content once $name', async ({ edit }) => {
            await recordLoopAcrossTempoChange(scenario);
            await executeAppAction(edit(recordedClip().id));
            flushAutomergeStorageWrites();
            const beats = [11, 11.5, 12, 14, 15.5];
            const uncomped = beats.map((beat) => fileSecondsAt(scenario, beat));

            await compLoop(scenario, 'Take 2');

            for (const [index, beat] of beats.entries()) {
                const content = uncomped[index]!;
                if (content < 0) {
                    expect(fileSecondsAt(scenario, beat)).toBeNull();
                } else {
                    expect(fileSecondsAt(scenario, beat)).toBeCloseTo(content, 9);
                }
            }
            expect(uncomped.filter((content) => content !== null && content >= 0).length).toBeGreaterThanOrEqual(4);
        });
    });

    describe('begun at the start of loop [8,16), the tempo dropping to 60 BPM at beat 12, no pre-roll', () => {
        const scenario: TempoChangeScenario = {
            recordPointBeat: 8,
            loop: [8, 16],
            preRollBars: 0,
            tempoChanges: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-12', beat: 12, tempo: 60, curve: 'instant' },
            ],
            // Pass 1 from the loop start, pass 2 a whole loop later.
            passDepths: [0, 8],
            // Two 6 s laps and part of a third.
            captureSeconds: 12 + 2 + 0.02,
        };
        /** Beat 8 sounds 4 s into the song; 20 ms of latency precede the record point. */
        const mediaOriginSeconds = 4 - 0.02;
        /** One lap of [8,16): 2 s at 120 BPM, then 4 s at 60 BPM. */
        const lapSeconds = 6;
        const capturedOnLap = (beat: number, lap: number) =>
            songSecondsAt(scenario, beat) + lap * lapSeconds - mediaOriginSeconds;

        it('enters pass 2 comped from after the tempo change at what was captured there', async () => {
            await recordLoopAcrossTempoChange(scenario);
            await compLoop(scenario, 'Take 3', [13, 16]);

            expect(fileSecondsAt(scenario, 13)).toBeCloseTo(capturedOnLap(13, 1), 9);
            expect(fileSecondsAt(scenario, 15.5)).toBeCloseTo(capturedOnLap(15.5, 1), 9);
        });
    });
});
