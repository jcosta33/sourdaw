import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayback } from '../../transportControls/startPlayback';
import { stopPlayback } from '../../transportControls/stopPlayback';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { processYeastMidi } from '#/modules/Yeast/useCases';

/** The actual browser start, MIDI/audio producers and tempo law run together.
 * Only engine calls, external Yeast work and foreign stores are controlled. */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
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
    takeLaneStore: { value: { lanes: [] } },
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
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
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
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));

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

function midiClip(id: string): unknown {
    return { id, type: 'midi', muted: false, startBeat: 1.5, endBeat: 2, loopEnabled: false, midiOffsetBeats: 0 };
}

function midiTrack(id: string, clipId: string, yeast: boolean): unknown {
    return {
        id,
        kind: 'midi',
        muted: false,
        sends: [],
        parentId: null,
        followChordTrack: false,
        automationMode: 'read',
        devices: yeast ? [{ id: 'yeast-rack', type: 'yeast' }] : [],
        clips: [midiClip(clipId)],
        freezeState: { status: 'unfrozen' },
    };
}

function seedProject(): void {
    const audio = {
        id: 'audio',
        type: 'audio',
        muted: false,
        audioBufferId: 'pcm',
        startBeat: 1.5,
        endBeat: 2,
        audioOffsetBeats: 0.2,
        stretchMode: 'off',
        stretchRatio: 1,
        loopEnabled: false,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
    };
    trackStoreState.value = {
        tracks: [
            midiTrack('plain-track', 'plain-midi', false),
            midiTrack('yeast-track', 'yeast-midi', true),
            {
                id: 'audio-track',
                kind: 'audio',
                muted: false,
                sends: [],
                clips: [audio],
                freezeState: { status: 'unfrozen' },
            },
        ],
    };
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
        seedProject();
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
        const playback = startPlayback().then(() => {
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
            ctxTime.now = 10;
            ready.resolve();
            await playback;
            await vi.waitFor(() => expect(sources).toHaveLength(1));
            expect(sources[0]!.start).toHaveBeenCalledExactlyOnceWith(10, 0.1, 0.25);
            expect(notes).toEqual([
                { pitch: 60, time: 10 },
                { pitch: 62, time: 10.075 },
                { pitch: 67, time: 10 },
            ]);
            expect(playheadClockRef).toEqual({ beat: 1.5, audioTimeSeconds: 10 });
            ctxTime.now = 10.05;
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
});
