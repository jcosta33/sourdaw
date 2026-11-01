import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { panicYeastRuntime } from '../../transportControls/panicYeastRuntime';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * A main-thread stall: the audio clock keeps rendering what was already
 * scheduled while no tick runs, so the song position is a function of the
 * audio clock, and the first tick after the stall must place every new
 * emission on the same clock the sources already playing follow. Driven
 * through the REAL `scheduleMetronome`, `scheduleAudioClips` and
 * `scheduleMidiNotes`; `scheduleClick`, `scheduleNote` and `source.start` are
 * the observation points.
 */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const midiStoreState: {
    value: {
        notesByClipId: Record<string, unknown[]>;
        ccByClipId: Record<string, unknown[]>;
        pitchBendByClipId: Record<string, unknown[]>;
        probabilitySeed: number;
    } | null;
} = { value: null };
const ctxTime = { now: 0 };

const audioContextStub = {
    sampleRate: 48000,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({
        connect: () => {},
        disconnect: () => {},
        gain: {
            value: 1,
            cancelScheduledValues: () => {},
            setValueAtTime: () => {},
            linearRampToValueAtTime: () => {},
        },
    }),
};

const trackStripStub = {
    gainNode: {},
    deviceNodes: [] as unknown[],
    preFaderTap: { connect: () => {} },
};

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRootIdentity: vi.fn<typeof import('#/modules/CrdtDocument/useCases').captureProjectRootIdentity>(
        () => 'root-identity'
    ),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    appendClipToTrack: vi.fn<typeof import('#/modules/Arrangement/stores').appendClipToTrack>(),
    clipSelectionStore: { value: null },
    resolveEligibleClipWriteTarget: vi.fn<typeof import('#/modules/Arrangement/stores').resolveEligibleClipWriteTarget>(
        () => ({ status: 'ineligible' })
    ),
    updateClipInStore: vi.fn(() => false),
    adjustmentLayerStore: { value: null },
    gainEnvelopeStore: { value: null },
    getTrackEligibility: vi.fn(),
    markerStore: { value: null },
    vcaGroupStore: { value: null },
    warpStateStore: { value: null },
    trackStore: {
        subscribe: () => () => {},
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: { value: { lanes: [] } },
    activeRecordingRef: { current: [] },
    getGainEnvelopeSeries: () => null,
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
vi.mock('#/modules/Automation/stores', () => ({
    modulationStore: { value: null },
    automationStore: { value: null },
}));
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    takeOwnsRecordingRoot: vi.fn(() => true),
    prepareRecoveredRecording: vi.fn(),
    admitRecordingCaptureClock: vi.fn(),
    observeRecordingPassEntry: vi.fn(),
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

type RecordedEmission = { time: number; requestedAt: number };
type RecordedNote = RecordedEmission & { pitch: number };
type RecordedSourceStart = RecordedEmission & { clipId: string; offset: number | undefined };

const scheduleClickSpy = vi.hoisted(() => vi.fn<(time: number, isAccent: boolean, volume: number) => void>());
const scheduleNoteSpy = vi.hoisted(() =>
    vi.fn<(ctx: unknown, destination: unknown, pitch: number, startTime: number, ...rest: unknown[]) => unknown>()
);
const recordedSourceStarts = vi.hoisted(() => [] as RecordedSourceStart[]);
/** Which clip the next buffer source belongs to, read off the buffer the scheduler assigns it. */
const bufferClipIds = vi.hoisted(() => new Map<unknown, string>());

vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureCachedAudioBuffersDurable: vi.fn(),
    createNativeRecordingCaptureClock: () => ({ last: null, read: () => ({ carrier: 'browser' as const }) }),
    analyzePitchForClip: vi.fn(),
    ensureBusStrip: vi.fn(),
    getEngineState: vi.fn(),
    removeSend: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    wireSidechainRoute: vi.fn(),
    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    getAudioContext: () => audioContextStub,
    getCurrentTime: () => ctxTime.now,
    scheduleClick: scheduleClickSpy,
    getCompensationDelay: () => 0,
    getDefaultBendRangeSemitones: () => 48,
    getNoteExpressionDimensions: () => [],
    getDrumKitByIndex: () => null,
    ensureTrackStrip: () => trackStripStub,
    getTrackStrip: () => trackStripStub,
    applyNoteExpression: vi.fn(),
    startNoteExpression: vi.fn(),
    advanceNoteExpression: vi.fn(),
    relocateNoteExpression: vi.fn(),
    registerScheduledSource: vi.fn(),
    scheduleFaustNote: vi.fn(),
    audioEngine: { setTransportInfo: vi.fn() },
    stopAllScheduled: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    createBufferSource: () => {
        const source = {
            buffer: null as unknown,
            connect: () => {},
            playbackRate: { value: 1 },
            start: (time: number, offset?: number) => {
                recordedSourceStarts.push({
                    clipId: bufferClipIds.get(source.buffer) ?? 'unknown',
                    time,
                    offset,
                    requestedAt: ctxTime.now,
                });
            },
            stop: () => {},
            onended: null,
        };
        return source;
    },
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => {
        for (const [buffer, clipId] of bufferClipIds) {
            if (`${clipId}-buf` === bufferId) {
                return buffer;
            }
        }
        return null;
    },
    getFactoryDrumKitByIndex: vi.fn(),
    readNativeEnginePlayheadSeconds: (): number | null => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: () => null,
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: scheduleNoteSpy,
    getSynthParamsFromDevices: vi.fn(() => ({})),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ isFaustInstrumentModule: () => false }));
vi.mock('#/modules/Yeast/useCases', () => ({
    hydrateYeastCrdtProjection: vi.fn(),
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../repositories/transport/updateTransportState', () => ({ updateTransportState: vi.fn() }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: () => ({ jumpToPosition: null, shouldStop: false }),
}));

const TEMPO_BPM = 120;
const BEATS_PER_SECOND = TEMPO_BPM / 60;
const TICK_SECONDS = 0.025;
const STEM_SECONDS = 60;

function audioTrack(id: string, clipId: string, startBeat: number): unknown {
    bufferClipIds.set({ duration: STEM_SECONDS }, clipId);
    return {
        id,
        kind: 'audio',
        muted: false,
        armed: false,
        sends: [],
        freezeState: { status: 'unfrozen', frozenBufferId: null },
        clips: [
            {
                id: clipId,
                type: 'audio',
                audioBufferId: `${clipId}-buf`,
                muted: false,
                startBeat,
                endBeat: 64,
                sourceStartSeconds: 0,
                gain: 1,
                fadeInBeats: 0.01,
                fadeOutBeats: 0.01,
            },
        ],
    };
}

function midiTrack(clipId: string): unknown {
    return {
        id: 'drums',
        kind: 'midi',
        muted: false,
        armed: false,
        parentId: null,
        followChordTrack: false,
        automationMode: 'read',
        sends: [],
        devices: [],
        freezeState: { status: 'unfrozen', frozenBufferId: null },
        clips: [
            {
                id: clipId,
                type: 'midi',
                muted: false,
                startBeat: 0,
                endBeat: 16,
                gain: 1,
                loopEnabled: false,
                midiOffsetBeats: 0,
            },
        ],
    };
}

/** One note on every beat, pitched by its beat so an emission names the beat it is for. */
function noteOnEveryBeat(): unknown[] {
    return Array.from({ length: 16 }, (_, beat) => ({
        id: `note-${beat}`,
        startBeat: beat,
        duration: 0.25,
        pitch: 40 + beat,
        velocity: 100,
        probability: 100,
    }));
}

function playingState(overrides: Partial<typeof defaultTransportState> = {}): typeof defaultTransportState {
    return {
        ...defaultTransportState,
        isPlaying: true,
        tempo: TEMPO_BPM,
        playheadPosition: 0,
        metronomeEnabled: true,
        ...overrides,
    };
}

type SchedulerWorkerHarness = { onmessage: ((event: { data: unknown }) => void) | null };

let schedulerTickSequence = 0;

async function advanceAudioClock(seconds: number): Promise<void> {
    ctxTime.now += seconds;
    schedulerTickSequence++;
    const receivedAtMs = performance.timeOrigin + performance.now();
    (schedulerSession.worker as unknown as SchedulerWorkerHarness).onmessage?.({
        data: {
            type: 'tick',
            generation: schedulerSession.generation,
            sequence: schedulerTickSequence,
            scheduledAtMs: receivedAtMs - 2,
            sentAtMs: receivedAtMs - 1,
        },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function tickFor(seconds: number): Promise<void> {
    const ticks = Math.round(seconds / TICK_SECONDS);
    for (let tick = 0; tick < ticks; tick++) {
        await advanceAudioClock(TICK_SECONDS);
    }
}

describe('startPlayheadScheduler after a main-thread stall', () => {
    let notes: RecordedNote[] = [];
    let clickRequests: RecordedEmission[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        notes = [];
        clickRequests = [];
        recordedSourceStarts.length = 0;
        bufferClipIds.clear();
        scheduleNoteSpy.mockImplementation((_ctx, _destination, pitch, time) => {
            notes.push({ pitch, time, requestedAt: ctxTime.now });
            return {};
        });
        scheduleClickSpy.mockImplementation((time) => {
            clickRequests.push({ time, requestedAt: ctxTime.now });
        });
        tempoMapStoreState.value = { changes: [] };
        trackStoreState.value = { tracks: [] };
        midiStoreState.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {}, probabilitySeed: 1 };
        metronomeSchedulingState.lastBeat = -1;
        metronomeSchedulingState.firedClickTimes.clear();
        playheadWrapCountRef.current = 0;
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

    it('keeps the click, the drums and a newly started clip on the clock of the stem already playing', async () => {
        // A stem from beat 0, a second clip from beat 3, and a drum note on
        // every beat. At 120 BPM beat b sounds at b / 2 seconds of the stem.
        trackStoreState.value = {
            tracks: [audioTrack('stem-track', 'stem', 0), audioTrack('late-track', 'late', 3), midiTrack('drums')],
        };
        midiStoreState.value = {
            notesByClipId: { drums: noteOnEveryBeat() },
            ccByClipId: {},
            pitchBendByClipId: {},
            probabilitySeed: 1,
        };
        transportStoreState.value = playingState();

        startPlayheadScheduler();
        await tickFor(1);

        // The stem started on the first tick and its content runs on the
        // context clock: content second s plays at context second s.
        const stem = recordedSourceStarts.filter((start) => start.clipId === 'stem');
        expect(stem).toHaveLength(1);
        expect(stem[0]!.time - (stem[0]!.offset ?? 0)).toBeCloseTo(0, 9);

        // The main thread stalls for 0.75 s: no tick runs while the stem plays
        // on from 1.0 s to 1.75 s, beats 2 to 3.5.
        const stallEndsAt = 1.75;
        await advanceAudioClock(stallEndsAt - ctxTime.now);
        await tickFor(0.5);

        // Beat 3 fell inside the stall: its click and its note are stale and
        // are not replayed as a burst. Beat 4 sounds at 2.0 s, on the stem.
        const afterStall = ({ requestedAt }: RecordedEmission) => requestedAt >= stallEndsAt;
        expect(clickRequests.filter(afterStall).map(({ time }) => time)).toEqual([expect.closeTo(2, 9)]);
        expect(notes.filter(afterStall).map(({ pitch, time }) => ({ pitch, time }))).toEqual([
            { pitch: 44, time: expect.closeTo(2, 9) },
        ]);
        for (const emission of [...clickRequests, ...notes].filter(afterStall)) {
            expect(emission.time).toBeGreaterThanOrEqual(emission.requestedAt);
        }

        // The clip whose start fell inside the stall joins mid-buffer at the
        // stall's end, holding the content the stem's clock says is due:
        // beat 3 (1.5 s) is its content origin.
        const late = recordedSourceStarts.filter((start) => start.clipId === 'late');
        expect(late).toHaveLength(1);
        expect(late[0]!.time).toBeCloseTo(stallEndsAt, 9);
        expect(late[0]!.time - (late[0]!.offset ?? 0)).toBeCloseTo(3 / BEATS_PER_SECOND, 9);
        expect(schedulerSession.accumulatedPosition).toBeCloseTo(2.25 * BEATS_PER_SECOND, 9);
    });

    it('plays an event a gap just past the look-ahead left overdue, late, without a relocation', async () => {
        trackStoreState.value = { tracks: [midiTrack('drums')] };
        midiStoreState.value = {
            notesByClipId: { drums: noteOnEveryBeat() },
            ccByClipId: {},
            pitchBendByClipId: {},
            probabilitySeed: 1,
        };
        transportStoreState.value = playingState();

        startPlayheadScheduler();
        // The last regular tick (1.375 s) schedules up to 1.475 s: beat 3, at
        // 1.5 s, is still ahead of the window.
        await tickFor(1.375);
        expect(notes.some(({ pitch }) => pitch === 43)).toBe(false);
        const epochBeforeGap = schedulerSession.discontinuityEpoch;
        vi.mocked(panicYeastRuntime).mockClear();

        // A routine 130 ms gap: the window start is 30 ms overdue, within one
        // look-ahead, so beat 3 is played 5 ms late rather than dropped.
        await advanceAudioClock(0.13);

        expect(notes.filter(({ pitch }) => pitch === 43)).toEqual([
            { pitch: 43, time: expect.closeTo(1.5, 9), requestedAt: expect.closeTo(1.505, 9) },
        ]);
        expect(clickRequests.filter(({ time }) => Math.abs(time - 1.5) < 1e-9)).toHaveLength(1);
        expect(vi.mocked(panicYeastRuntime)).not.toHaveBeenCalled();
        expect(schedulerSession.discontinuityEpoch).toBe(epochBeforeGap);
    });

    it('drops the events of a stall that left the window more than a look-ahead overdue', async () => {
        trackStoreState.value = { tracks: [midiTrack('drums')] };
        midiStoreState.value = {
            notesByClipId: { drums: noteOnEveryBeat() },
            ccByClipId: {},
            pitchBendByClipId: {},
            probabilitySeed: 1,
        };
        transportStoreState.value = playingState();

        startPlayheadScheduler();
        await tickFor(1.375);
        const epochBeforeGap = schedulerSession.discontinuityEpoch;
        vi.mocked(panicYeastRuntime).mockClear();

        // 250 ms with no tick: the window start (1.475 s) is 150 ms behind the
        // clock, so beat 3 (1.5 s) is stale and the window opens at the
        // playhead as a relocation.
        await advanceAudioClock(0.25);

        expect(notes.filter(({ pitch }) => pitch === 43)).toEqual([]);
        expect(clickRequests.filter(({ time }) => Math.abs(time - 1.5) < 1e-9)).toEqual([]);
        expect(vi.mocked(panicYeastRuntime)).toHaveBeenCalledTimes(1);
        expect(schedulerSession.discontinuityEpoch).toBe(epochBeforeGap + 1);
    });

    it('lands a stall that crosses several loop seams on the pass the audio clock is in', async () => {
        // Loop [0, 2) at 120 BPM is a one-second pass; past the loop end the
        // map drops to 60 BPM, a zone a looping roll never travels.
        tempoMapStoreState.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 2, tempo: 60, curve: 'instant' },
            ],
        };
        transportStoreState.value = playingState({ isLooping: true, loopStart: 0, loopEnd: 2 });

        startPlayheadScheduler();
        await tickFor(0.3);

        // 2.3 s with no tick: the roll crosses the seams at 1 s and 2 s and
        // stands 0.6 s into its third pass at 2.6 s.
        await advanceAudioClock(2.3);

        expect(schedulerSession.accumulatedPosition).toBeCloseTo(1.2, 9);
        expect(playheadClockRef.beat).toBeCloseTo(1.2, 9);
        // Both seams the audio crossed count, so a loop-recorded event after
        // the stall is dated in the pass it was played in.
        expect(playheadWrapCountRef.current).toBe(2);
        // The first click after the stall is the pass's beat 0 at 3.0 s
        // (beat 1.2 → 2 is 0.4 s) — none from the passes the stall skipped.
        await tickFor(0.5);
        const afterStall = clickRequests.filter(({ requestedAt }) => requestedAt >= 2.6);
        expect(afterStall.map(({ time }) => time)).toEqual([expect.closeTo(3, 9)]);
    });
});
