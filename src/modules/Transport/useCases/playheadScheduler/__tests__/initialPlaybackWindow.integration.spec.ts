import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayback } from '../../transportControls/startPlayback';
import { stopPlayback } from '../../transportControls/stopPlayback';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { captureGestureBeat } from '../../../stores/captureGestureBeat';
import { setGestureClockSource } from '../../../stores/gestureClockSource';
import { processYeastMidi, yeastPanic } from '#/modules/Yeast/useCases';
import { startRecording } from '#/modules/Arrangement/useCases';
import { startAudioRecording } from '#/modules/AudioEngine/useCases';

/** The actual browser start, MIDI/audio producers and tempo law run together.
 * Only engine calls, external Yeast work and foreign stores are controlled. */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const takeStoreState: { value: { lanes: unknown[] } } = { value: { lanes: [] } };
const midiStoreState: {
    value: { notesByClipId: Record<string, unknown[]>; probabilitySeed: number } | null;
} = { value: null };
const ctxTime = { now: 0 };

const audioContextStub = {
    sampleRate: 48000,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({
        gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
    }),
};

const trackStripStub = {
    gainNode: {},
    deviceNodes: [] as unknown[],
    preFaderTap: { connect: () => {} },
};

const projectRoot = { current: 'startup-root' };
vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRootIdentity: () => projectRoot.current }));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: {
        get value() {
            return takeStoreState.value;
        },
    },
    // The loop-wrap take path reads which clips are actively recording; no test
    // here records, so the ref stays empty.
    activeRecordingRef: { current: [] },
    getGainEnvelopeSeries: () => undefined,
    // Pulled in transitively: the scheduler reaches Levain's param bridge, whose
    // dependency bundle destructures these off this barrel at module scope. A
    // factory that omits them fails the whole file at import, not at a test.
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return midiStoreState.value;
        },
    },
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiState: vi.fn(),
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
vi.mock('#/modules/Automation/stores', () => ({ automationStore: { value: null } }));
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    stopAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    takeOwnsRecordingRoot: vi.fn(() => true),
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
/**
 * Second observation point: the metronome shares `lastScheduledBeat` as its
 * `fromBeat`, so moving the loop-wrap anchor moves the click window too.
 */
const scheduleClickSpy = vi.hoisted(() => vi.fn<(time: number, isAccent: boolean, volume: number) => void>());
vi.mock('#/modules/AudioEngine/useCases', () => ({
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
    audioEngine: { setTransportInfo: (...args: unknown[]) => transportPublications.push(args) },
    stopAllScheduled: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    createBufferSource: () => {
        const source = {
            buffer: null,
            playbackRate: { value: 1 },
            connect: vi.fn(),
            disconnect: vi.fn(),
            stop: vi.fn(),
            start: vi.fn<(when: number, offset: number, duration: number) => void>(),
        };
        sources.push(source);
        return source;
    },
    getCachedAudioBuffer: () => ({ sampleRate: 48_000, length: 48_000, duration: 1 }),
    resumeEngine: () => Promise.resolve(),
    nativeLiveGraphSessionOffered: () => false,
    startNativeLiveGraphSession: vi.fn(),
    stopNativeLiveGraphSession: () => Promise.resolve(),
    getFactoryDrumKitByIndex: vi.fn(),
    // No native engine here: the cursor these seams are about follows the
    // scheduler's own integration.
    readNativeEnginePlayheadSeconds: (): number | null => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
/**
 * The observation point. Typed to the four arguments the assertions read, so
 * the recorded pitch/time come from the production call rather than a cast.
 */
const scheduleNoteSpy = vi.hoisted(() =>
    vi.fn<(ctx: unknown, destination: unknown, pitch: number, startTime: number, ...rest: unknown[]) => unknown>()
);
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: () => null,
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: scheduleNoteSpy,
    getSynthParamsFromDevices: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ isFaustInstrumentModule: () => false }));
vi.mock('#/modules/Yeast/useCases', () => ({
    processYeastMidi: vi.fn(),
    yeastPanic: vi.fn(() => Promise.resolve()),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
vi.mock('#/modules/Yeast/stores', () => ({ readYeastRack: () => ({ processors: [] }) }));
vi.mock('#/modules/Collaboration/stores', () => ({ collaborationStore: { value: null } }));
vi.mock('#/modules/Collaboration/useCases', () => ({ getAssetTransfer: () => null }));
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: vi.fn() }));
vi.mock('../../transportControls/stopActiveRecording', () => ({ stopActiveRecording: () => Promise.resolve() }));
// scheduleMetronome and resetMetronomeBeat run for real: the seam anchor is
// their window boundary too, and the click dedup they rely on is exactly the
// thing a wider window can defeat.
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));

const evaluateFollowActionsMock = vi.fn<
    (tracks: unknown[], from: number, to: number) => { jumpToPosition: number | null; shouldStop: boolean }
>(() => ({ jumpToPosition: null, shouldStop: false }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: (...args: unknown[]) => (evaluateFollowActionsMock as (...a: unknown[]) => unknown)(...args),
}));

type SourceStart = { start: ReturnType<typeof vi.fn<(when: number, offset: number, duration: number) => void>> };
const sources: SourceStart[] = [];
const transportPublications: unknown[][] = [];
const notes: { pitch: number; time: number }[] = [];
type FixtureWorker = { onmessage: ((event: { data: unknown }) => void) | null; generation: number };
const workers: FixtureWorker[] = [];
let sequence = 0;

function deliverWorkerTick(): void {
    const received = performance.timeOrigin + performance.now();
    for (const worker of workers) {
        worker.onmessage?.({
            data: {
                type: 'tick',
                generation: worker.generation,
                sequence: ++sequence,
                scheduledAtMs: received - 2,
                sentAtMs: received - 1,
            },
        });
    }
}

function midiClip(id: string, startBeat = 1.5) {
    return {
        id,
        type: 'midi',
        muted: false,
        startBeat,
        endBeat: startBeat + 0.5,
        loopEnabled: false,
        midiOffsetBeats: 0,
    };
}

function midiTrack(id: string, clipId: string, yeast: boolean, startBeat = 1.5) {
    return {
        id,
        kind: 'midi',
        muted: false,
        sends: [],
        parentId: null,
        followChordTrack: false,
        automationMode: 'read',
        devices: yeast ? [{ id: 'yeast-rack', type: 'yeast' }] : [],
        clips: [midiClip(clipId, startBeat)],
        freezeState: { status: 'unfrozen' },
    };
}

function programmeTracks(recordingClip?: ReturnType<typeof startRecording>[number], audioStartBeat = 1.5) {
    const audio = {
        id: 'audio',
        type: 'audio',
        muted: false,
        audioBufferId: 'pcm',
        startBeat: audioStartBeat,
        endBeat: 2,
        audioOffsetBeats: 0.2,
        stretchMode: 'off',
        stretchRatio: 1,
        loopEnabled: false,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
    };
    return [
        {
            ...midiTrack('plain-track', 'plain-midi', false),
            armed: recordingClip?.trackId === 'plain-track',
            clips: [midiClip('plain-midi'), ...(recordingClip?.trackId === 'plain-track' ? [recordingClip] : [])],
        },
        midiTrack('yeast-track', 'yeast-midi', true),
        {
            id: 'audio-track',
            kind: 'audio',
            armed: recordingClip?.trackId === 'audio-track',
            devices: [],
            muted: false,
            sends: [],
            clips: [audio, ...(recordingClip?.trackId === 'audio-track' ? [recordingClip] : [])],
            freezeState: { status: 'unfrozen' },
        },
    ];
}

function seedProject(): void {
    trackStoreState.value = { tracks: programmeTracks() };
    const note = (id: string, pitch: number, startBeat: number) => ({
        id,
        pitch,
        startBeat,
        duration: 0.05,
        velocity: 100,
        probability: 100,
    });
    midiStoreState.value = {
        notesByClipId: {
            'plain-midi': [note('head', 60, 0), note('later', 62, 0.15)],
            'yeast-midi': [note('yeast-head', 67, 0)],
        },
        probabilitySeed: 1,
    };
    transportStoreState.value = {
        ...defaultTransportState,
        tempo: 120,
        playheadPosition: 1.5,
        isPlaying: false,
        preRollEnabled: false,
    };
}

describe('initial browser playback window', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(yeastPanic).mockResolvedValue(undefined);
        vi.mocked(startRecording).mockReset();
        vi.mocked(startRecording).mockReturnValue([]);
        vi.mocked(processYeastMidi).mockImplementation(async (input) => [...input.events]);
        vi.mocked(startAudioRecording).mockResolvedValue(true);
        disposePlayheadScheduler();
        sources.length = 0;
        notes.length = 0;
        transportPublications.length = 0;
        workers.length = 0;
        sequence = 0;
        projectRoot.current = 'startup-root';
        ctxTime.now = 8;
        playheadClockRef.beat = 1.5;
        playheadClockRef.audioTimeSeconds = 0;
        metronomeSchedulingState.lastBeat = -1;
        metronomeSchedulingState.firedClickTimes.clear();
        tempoMapStoreState.value = { changes: [] };
        takeStoreState.value = { lanes: [] };
        seedProject();
        setGestureClockSource({ getAudioTimeSeconds: () => ctxTime.now, readNativeCursorBeats: () => null });
        scheduleNoteSpy.mockImplementation((_context, _destination, pitch, time) => {
            notes.push({ pitch, time });
            return {};
        });
        evaluateFollowActionsMock.mockReturnValue({ jumpToPosition: null, shouldStop: false });
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: { data: unknown }) => void) | null = null;
                generation = 0;
                constructor() {
                    workers.push(this);
                }
                postMessage(data: { type: string; generation?: number }): void {
                    if (data.type === 'start') this.generation = data.generation ?? 0;
                }
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

    it('prepares pending Yeast before one shared roll and preserves the attack despite a delayed first Worker tick', async () => {
        const ready = Promise.withResolvers<void>();
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            await ready.promise;
            return [...input.events];
        });
        let settled = false;
        const onRoll = vi.fn<(contextSeconds: number, beat: number) => void>(() => {
            expect(notes).toEqual([]);
            expect(sources).toHaveLength(0);
        });
        const playback = startPlayback(onRoll).then(() => {
            settled = true;
        });
        ctxTime.now = 8.05;
        deliverWorkerTick();
        try {
            await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalled());
            expect(settled).toBe(false);
            expect(notes).toEqual([]);
            expect(sources).toHaveLength(0);
            expect(transportPublications).toEqual([]);
            expect(playheadClockRef.audioTimeSeconds).toBe(0);
            expect(captureGestureBeat()).toBe(1.5);
            expect(onRoll).not.toHaveBeenCalled();
            ctxTime.now = 10;
            ready.resolve();
            await playback;
            await vi.waitFor(() => expect(sources).toHaveLength(1));
            // The existing 100 ms scheduling lead follows readiness; it is not source slip.
            const anchor = 10.1;
            expect(onRoll).toHaveBeenCalledExactlyOnceWith(anchor, 1.5);
            expect(sources[0]!.start).toHaveBeenCalledExactlyOnceWith(anchor, 0.1, 0.25);
            expect(notes.map(({ pitch, time }) => ({ pitch, frame: Math.round(time * 48_000) }))).toEqual([
                { pitch: 60, frame: 484_800 },
                { pitch: 62, frame: 488_400 },
                { pitch: 67, frame: 484_800 },
            ]);
            expect(playheadClockRef).toEqual({ beat: 1.5, audioTimeSeconds: anchor, hold: null });
            ctxTime.now = 10.05;
            deliverWorkerTick();
            await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false));
            expect(playheadClockRef).toEqual({ beat: 1.5, audioTimeSeconds: anchor, hold: null });
            expect(captureGestureBeat()).toBe(1.5);
            ctxTime.now = 10.15;
            deliverWorkerTick();
            await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false));
            expect(sources).toHaveLength(1);
            expect(notes).toHaveLength(3);
            expect(playheadClockRef.beat).toBeCloseTo(1.6, 12);
        } finally {
            ready.resolve();
            await playback;
        }
    });

    it.each(['stop', 'project switch'] as const)('emits no stale prepared window after %s', async (change) => {
        const ready = Promise.withResolvers<void>();
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            await ready.promise;
            return [...input.events];
        });
        const playback = startPlayback();
        deliverWorkerTick();
        try {
            await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalled());
            if (change === 'stop') await stopPlayback();
            else projectRoot.current = 'replacement-root';
            ctxTime.now = 10;
            ready.resolve();
            await playback;
            expect(notes).toEqual([]);
            expect(sources).toHaveLength(0);
        } finally {
            ready.resolve();
            await playback;
        }
    });

    function seedSeam(): void {
        const tracks = programmeTracks();
        trackStoreState.value = {
            tracks: [
                ...tracks,
                midiTrack('incoming-track', 'incoming-midi', false, 0),
                {
                    ...tracks[2],
                    id: 'incoming-audio-track',
                    clips: [
                        {
                            id: 'incoming-audio',
                            type: 'audio',
                            muted: false,
                            audioBufferId: 'pcm',
                            startBeat: 0,
                            endBeat: 0.5,
                            audioOffsetBeats: 0.2,
                            stretchMode: 'off',
                            stretchRatio: 1,
                            loopEnabled: false,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                        },
                    ],
                },
            ],
        };
        midiStoreState.value = {
            notesByClipId: {
                ...midiStoreState.value?.notesByClipId,
                'incoming-midi': [{ id: 'incoming', pitch: 72, startBeat: 0, duration: 0.05, velocity: 100 }],
            },
            probabilitySeed: 1,
        };
        transportStoreState.value = {
            ...defaultTransportState,
            tempo: 120,
            playheadPosition: 1.5,
            preRollEnabled: false,
            isLooping: true,
            loopStart: 0,
            loopEnd: 1.65,
            metronomeEnabled: true,
        };
    }

    it('waits for the real seam panic before choosing one future anchor for both passes', async () => {
        seedSeam();
        const ready = Promise.withResolvers<void>();
        vi.mocked(yeastPanic).mockImplementationOnce(() => ready.promise);
        const onRoll = vi.fn<(contextSeconds: number, beat: number) => void>();
        const playback = startPlayback(onRoll);
        try {
            await vi.waitFor(() => expect(yeastPanic).toHaveBeenCalled());
            expect(processYeastMidi).not.toHaveBeenCalled();
            expect(notes).toEqual([]);
            expect(sources).toHaveLength(0);
            expect(transportPublications).toEqual([]);
            expect(playheadClockRef.audioTimeSeconds).toBe(0);
            ctxTime.now = 10;
            ready.resolve();
            await playback;
            expect(notes.map(({ pitch, time }) => ({ pitch, frame: Math.round(time * 48_000) }))).toEqual([
                { pitch: 60, frame: 484_800 },
                { pitch: 67, frame: 484_800 },
                { pitch: 72, frame: 488_400 },
            ]);
            expect(sources).toHaveLength(2);
            expect(sources[0]!.start.mock.calls[0]?.[0]).toBeCloseTo(10.1, 12);
            expect(sources[1]!.start.mock.calls[0]?.[0]).toBeCloseTo(10.175, 12);
            expect(scheduleClickSpy).toHaveBeenCalledTimes(1);
            expect(scheduleClickSpy.mock.calls[0]?.[0]).toBeCloseTo(10.175, 12);
            expect(playheadClockRef).toEqual({ beat: 1.5, audioTimeSeconds: 10.1, hold: null });
            expect(onRoll).toHaveBeenCalledExactlyOnceWith(10.1, 1.5);
        } finally {
            ready.resolve();
            await playback;
        }
    });

    it.each(['stop', 'project switch'] as const)(
        'cancels admission while the real seam panic waits after %s',
        async (change) => {
            seedSeam();
            const ready = Promise.withResolvers<void>();
            vi.mocked(yeastPanic).mockImplementationOnce(() => ready.promise);
            const playback = startPlayback();
            try {
                await vi.waitFor(() => expect(yeastPanic).toHaveBeenCalled());
                if (change === 'stop') await stopPlayback();
                else projectRoot.current = 'replacement-root';
                ctxTime.now = 10;
                ready.resolve();
                await playback;
                expect(processYeastMidi).not.toHaveBeenCalled();
                expect(notes).toEqual([]);
                expect(sources).toHaveLength(0);
                expect(scheduleClickSpy).not.toHaveBeenCalled();
            } finally {
                ready.resolve();
                await playback;
            }
        }
    );

    it.each(['unchanged', 'source edited'] as const)(
        'validates the programme after punch-in creates its clip and take: %s',
        async (change) => {
            trackStoreState.value = {
                tracks: programmeTracks().map((track) => ({ ...track, armed: track.id === 'plain-track' })),
            };
            transportStoreState.value = {
                ...defaultTransportState,
                tempo: 120,
                playheadPosition: 1.5,
                preRollEnabled: false,
                punchInEnabled: true,
                punchInBeat: 1,
                punchOutBeat: 2,
            };
            const clip: ReturnType<typeof startRecording>[number] = {
                id: 'recording-clip',
                trackId: 'plain-track',
                name: 'Recording',
                type: 'midi',
                startBeat: 1.5,
                endBeat: 1.5,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
            };
            vi.mocked(startRecording).mockImplementation(() => {
                trackStoreState.value = { tracks: programmeTracks(clip) };
                takeStoreState.value = { lanes: [{ id: 'recording-lane', clipId: clip.id }] };
                return [clip];
            });
            const ready = Promise.withResolvers<void>();
            vi.mocked(processYeastMidi).mockImplementation(async (input) => {
                await ready.promise;
                return [...input.events];
            });
            const playback = startPlayback();
            try {
                await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalled());
                expect(startRecording).toHaveBeenCalledExactlyOnceWith(1.5);
                expect(transportStoreState.value?.isRecording).toBe(true);
                expect(notes).toEqual([]);
                if (change === 'source edited') {
                    midiStoreState.value = { notesByClipId: {}, probabilitySeed: 1 };
                }
                ctxTime.now = 10;
                ready.resolve();
                await playback;
                expect(transportStoreState.value?.isPlaying).toBe(change === 'unchanged');
                expect(transportStoreState.value?.isRecording).toBe(change === 'unchanged');
                expect(notes).toHaveLength(change === 'unchanged' ? 3 : 0);
                expect(sources).toHaveLength(change === 'unchanged' ? 1 : 0);
                if (change === 'unchanged') {
                    expect(playheadClockRef).toEqual({ beat: 1.5, audioTimeSeconds: 10.1, hold: null });
                }
            } finally {
                ready.resolve();
                await playback;
            }
        }
    );

    it.each(['stop', 'project switch'] as const)(
        'keeps the admitted callback boundary cancellable by %s',
        async (change) => {
            let stopped: Promise<void> | undefined;
            await startPlayback(() => {
                if (change === 'stop') stopped = stopPlayback();
                else projectRoot.current = 'replacement-root';
            });
            await stopped;
            expect(notes).toEqual([]);
            expect(sources).toHaveLength(0);
            expect(scheduleClickSpy).not.toHaveBeenCalled();
        }
    );

    it('holds mid-clip live and frozen sources to the initial anchor with their due content', async () => {
        trackStoreState.value = {
            tracks: [
                ...programmeTracks(undefined, 1),
                {
                    ...midiTrack('frozen-track', 'frozen-clip', false, 1),
                    freezeState: { status: 'frozen', frozenBufferId: 'pcm' },
                },
            ],
        };
        await startPlayback();
        expect(sources).toHaveLength(2);
        expect(sources[0]!.start).toHaveBeenCalledExactlyOnceWith(8.1, 0.25);
        const liveStart = sources[1]!.start.mock.calls[0];
        expect(liveStart?.[0]).toBeCloseTo(8.1, 12);
        expect(liveStart?.[1]).toBeCloseTo(0.35, 12);
        expect(liveStart?.[2]).toBeCloseTo(0.25, 12);
    });

    it.each(['admitted', 'stop', 'project switch'] as const)(
        'keeps initial punch audio admission bound to its programme: %s',
        async (outcome) => {
            trackStoreState.value = {
                tracks: programmeTracks().map((track) => ({ ...track, armed: track.id === 'audio-track' })),
            };
            transportStoreState.value = {
                ...defaultTransportState,
                tempo: 120,
                playheadPosition: 1.5,
                preRollEnabled: false,
                punchInEnabled: true,
                punchInBeat: 1,
                punchOutBeat: 2,
            };
            const clip: ReturnType<typeof startRecording>[number] = {
                id: 'recording-clip',
                trackId: 'audio-track',
                name: 'Recording',
                type: 'audio',
                startBeat: 1.5,
                endBeat: 1.5,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
            };
            vi.mocked(startRecording).mockImplementation(() => {
                trackStoreState.value = { tracks: programmeTracks(clip) };
                return [clip];
            });
            const ready = Promise.withResolvers<boolean>();
            vi.mocked(startAudioRecording).mockReturnValueOnce(ready.promise);
            const onRoll = vi.fn<(contextSeconds: number, beat: number) => void>();
            const playback = startPlayback(onRoll);
            try {
                await vi.waitFor(() => expect(startAudioRecording).toHaveBeenCalled());
                expect(notes).toEqual([]);
                expect(sources).toHaveLength(0);
                expect(onRoll).not.toHaveBeenCalled();
                expect(playheadClockRef.audioTimeSeconds).toBe(0);
                if (outcome === 'stop') await stopPlayback();
                else if (outcome === 'project switch') projectRoot.current = 'replacement-root';
                ctxTime.now = 10;
                ready.resolve(true);
                await playback;
                if (outcome === 'admitted') {
                    expect(onRoll).toHaveBeenCalledExactlyOnceWith(10.1, 1.5);
                    expect(transportStoreState.value?.isRecording).toBe(true);
                    expect(notes).toHaveLength(3);
                    expect(sources).toHaveLength(1);
                } else {
                    expect(onRoll).not.toHaveBeenCalled();
                    expect(notes).toEqual([]);
                    expect(sources).toHaveLength(0);
                }
            } finally {
                ready.resolve(true);
                await playback;
            }
        }
    );

    it('holds registered gesture capture at the requested beat across a tempo switch while Yeast waits', async () => {
        tempoMapStoreState.value = {
            changes: [
                { id: 'old-tempo', beat: 0, tempo: 300, curve: 'instant' },
                { id: 'held-tempo', beat: 1, tempo: 60, curve: 'instant' },
            ],
        };
        playheadClockRef.beat = 0;
        const ready = Promise.withResolvers<void>();
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            await ready.promise;
            return [...input.events];
        });
        const playback = startPlayback();
        try {
            await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalled());
            ctxTime.now = 9;
            expect(captureGestureBeat()).toBe(1.5);
            expect(playheadClockRef.beat).toBe(0);
            ctxTime.now = 10;
            ready.resolve();
            await playback;
            expect(playheadClockRef.hold).toBeNull();
            expect(captureGestureBeat()).toBe(1.5);
        } finally {
            ready.resolve();
            await playback;
        }
    });

    it('keeps a newer Play hold when an older preparation settles after Stop', async () => {
        const oldReady = Promise.withResolvers<void>();
        const newReady = Promise.withResolvers<void>();
        vi.mocked(processYeastMidi)
            .mockImplementationOnce(async (input) => {
                await oldReady.promise;
                return [...input.events];
            })
            .mockImplementationOnce(async (input) => {
                await newReady.promise;
                return [...input.events];
            });
        const outgoing = startPlayback();
        let incoming: Promise<void> | undefined;
        try {
            await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledTimes(1));
            await stopPlayback();
            expect(playheadClockRef.hold).toBeNull();
            seedProject();
            transportStoreState.value = {
                ...defaultTransportState,
                tempo: 120,
                playheadPosition: 1.75,
                preRollEnabled: false,
            };
            incoming = startPlayback();
            await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledTimes(2));
            const incomingGeneration = schedulerSession.generation;
            oldReady.resolve();
            await outgoing;
            expect(playheadClockRef.hold).toEqual({ generation: incomingGeneration, beat: 1.75 });
            expect(captureGestureBeat()).toBe(1.75);
            expect(notes).toEqual([]);
            ctxTime.now = 10;
            newReady.resolve();
            await incoming;
            expect(playheadClockRef.hold).toBeNull();
            expect(captureGestureBeat()).toBe(1.75);
        } finally {
            oldReady.resolve();
            newReady.resolve();
            await outgoing;
            await incoming;
        }
    });
});
