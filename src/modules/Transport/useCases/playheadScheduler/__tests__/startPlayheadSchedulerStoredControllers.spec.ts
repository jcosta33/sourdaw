import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { forgetStoredControllerEngagements } from '../../../services/storedControllerEngagement';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * What a Grand Boule's pedal is told when playback that is already rolling is
 * relocated: a scheduled loop seam, a late loop wrap, a follow-action jump. The
 * scheduler, the real `scheduleMidiNotes`, the real stored-controller projection
 * and the engagement record all run; only the engine is a recorder, so every
 * assertion reads a pedal move the instrument actually received and the frame it
 * was told to apply it at.
 */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const midiStoreState: {
    value: {
        notesByClipId: Record<string, unknown[]>;
        ccByClipId: Record<string, unknown[]>;
        probabilitySeed: number;
    } | null;
} = { value: null };
const ctxTime = { now: 0 };

const SAMPLE_RATE = 48_000;
const audioContextStub = {
    sampleRate: SAMPLE_RATE,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({ connect: () => {} }),
};

type PedalCall = { position: number; frame: number | undefined };
const pedalCalls = vi.hoisted(() => [] as { position: number; frame: number | undefined }[]);
const otherPedalCalls = vi.hoisted(() => [] as string[]);

const grandBouleControls = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    noteExpression: vi.fn(),
    setSustain: (position: number, frame?: number) => {
        pedalCalls.push({ position, frame });
    },
    setSostenuto: (engaged: boolean) => {
        otherPedalCalls.push(`sostenuto ${engaged}`);
    },
    setUnaCorda: (engaged: boolean) => {
        otherPedalCalls.push(`unaCorda ${engaged}`);
    },
};

const trackStripStub = {
    gainNode: {},
    deviceNodes: [{ type: 'grand-boule', deviceId: 'gb-1', grandBouleControls }] as unknown[],
    preFaderTap: { connect: () => {} },
};

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: { value: { lanes: [] } },
    activeRecordingRef: { current: [] },
    // Pulled in transitively by the real MIDI barrel this spec runs the projection through.
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
    appendClipToTrack: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    updateClipInStore: vi.fn(),
    clipSelectionStore: { value: null },
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
vi.mock('../../../stores/tempoMapStore', () => ({ tempoMapStore: { value: { changes: [] } } }));
vi.mock('../../../stores/timeSignatureMapStore', () => ({ timeSignatureMapStore: { value: { changes: [] } } }));
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
vi.mock('#/modules/AudioEngine/useCases', () => ({
    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    getAudioContext: () => audioContextStub,
    getCurrentTime: () => ctxTime.now,
    scheduleClick: vi.fn(),
    getCompensationDelay: () => 0,
    getDefaultBendRangeSemitones: () => 48,
    getDrumKitByIndex: () => null,
    ensureTrackStrip: () => trackStripStub,
    getTrackStrip: () => trackStripStub,
    applyNoteExpression: vi.fn(),
    registerScheduledSource: vi.fn(),
    scheduleFaustNote: vi.fn(),
    audioEngine: { setTransportInfo: vi.fn() },
    stopAllScheduled: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    createBufferSource: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
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
    scheduleNote: vi.fn(),
    getSynthParamsFromDevices: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ isFaustInstrumentModule: () => false }));
vi.mock('#/modules/Yeast/useCases', () => ({
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../repositories/transport/updateTransportState', () => ({ updateTransportState: vi.fn() }));

const evaluateFollowActionsMock = vi.fn<
    (tracks: unknown[], from: number, to: number) => { jumpToPosition: number | null; shouldStop: boolean }
>(() => ({ jumpToPosition: null, shouldStop: false }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: (...args: unknown[]) => (evaluateFollowActionsMock as (...a: unknown[]) => unknown)(...args),
}));

const TEMPO_BPM = 120;
const BEATS_PER_SECOND = TEMPO_BPM / 60;
/** 0.07 s per tick, deliberately not a divisor of the loop, so a wrap overshoots. */
const TICK_SECONDS = 0.07;

function controller(id: string, controllerNumber: number, value: number, beat: number) {
    return { id, controller: controllerNumber, value, beat, channel: 0 };
}

function pedal(id: string, value: number, beat: number) {
    return controller(id, 64, value, beat);
}

/** One 8-beat clip on a Grand Boule track, carrying the given controller lane and no notes. */
function loadClip(lane: ReturnType<typeof controller>[]): void {
    trackStoreState.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'midi',
                muted: false,
                armed: false,
                parentId: null,
                followChordTrack: false,
                automationMode: 'read',
                devices: [{ id: 'gb-1', type: 'grand-boule' }],
                sends: [],
                clips: [
                    {
                        id: 'clip-1',
                        type: 'midi',
                        muted: false,
                        startBeat: 0,
                        endBeat: 8,
                        gain: 1,
                        loopEnabled: false,
                        midiOffsetBeats: 0,
                    },
                ],
                freezeState: { status: 'unfrozen', frozenBufferId: null },
            },
        ],
    };
    midiStoreState.value = {
        notesByClipId: { 'clip-1': [] },
        ccByClipId: { 'clip-1': lane },
        probabilitySeed: 1,
    };
}

function playingState(overrides: Partial<typeof defaultTransportState> = {}): typeof defaultTransportState {
    return { ...defaultTransportState, isPlaying: true, tempo: TEMPO_BPM, playheadPosition: 0, ...overrides };
}

type SchedulerWorkerHarness = { onmessage: ((event: { data: unknown }) => void) | null };

let schedulerTickSequence = 0;

async function runTick(): Promise<void> {
    const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
    ctxTime.now += TICK_SECONDS;
    schedulerTickSequence++;
    const receivedAtMs = performance.timeOrigin + performance.now();
    worker.onmessage?.({
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

/** Ticks, then tests `done` once per tick: it may keep state between calls. */
async function runTicksUntil(done: () => boolean, maxTicks = 500): Promise<void> {
    for (let tick = 0; tick < maxTicks; tick++) {
        await runTick();
        if (done()) {
            return;
        }
    }
    throw new Error(`the awaited scheduler state was not reached in ${maxTicks} ticks`);
}

/** The frame the engine is told to apply a pedal move at, as the seam instant it lands on. */
function frameOf(seconds: number): number {
    return Math.round(seconds * SAMPLE_RATE);
}

function framedCalls(): PedalCall[] {
    return pedalCalls.filter((call) => call.frame !== undefined);
}

describe('startPlayheadScheduler stored controller restore at a relocation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pedalCalls.length = 0;
        otherPedalCalls.length = 0;
        forgetStoredControllerEngagements();
        evaluateFollowActionsMock.mockImplementation(() => ({ jumpToPosition: null, shouldStop: false }));
        midiStoreState.value = null;
        trackStoreState.value = { tracks: [] };
        metronomeSchedulingState.lastBeat = -1;
        metronomeSchedulingState.firedClickTimes.clear();
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

    // The lane every case below starts from: pedal up at the head, down at 3.5,
    // up at 6 — so a pass that wraps from 4 to 2 leaves the pedal down.
    const pedalLane = () => [pedal('up-0', 0, 0), pedal('down', 127, 3.5), pedal('up-6', 0, 6)];

    describe('scheduled loop seam', () => {
        it('restores the value in force at the loop start for the incoming pass, then presses again at 3.5', async () => {
            loadClip(pedalLane());
            transportStoreState.value = playingState({ isLooping: true, loopStart: 2, loopEnd: 4 });
            startPlayheadScheduler();

            await runTicksUntil(() => schedulerSession.pendingSeam !== null);
            const seamFrame = frameOf(schedulerSession.pendingSeam!.seamAudioTime);

            // Everything up to the seam: the head's up, the press at 3.5, and the
            // restore for the incoming pass at the seam frame.
            expect(pedalCalls.map((call) => call.position)).toEqual([0, 1, 0]);
            const restore = pedalCalls[2]!;
            expect(restore.frame).toBeDefined();
            expect(Math.abs(restore.frame! - seamFrame)).toBeLessThanOrEqual(1);
            // The pedal the dying pass left down is never lifted frameless here: that
            // would discard the dying window's own queued moves.
            expect(pedalCalls.filter((call) => call.frame === undefined)).toEqual([]);

            // The incoming pass presses again at its own 3.5, one pass later.
            await runTicksUntil(() => pedalCalls.length >= 4);
            const secondPress = pedalCalls[3]!;
            expect(secondPress.position).toBe(1);
            const beatsFromLoopStart = 3.5 - 2;
            const expectedFrame = seamFrame + (beatsFromLoopStart / BEATS_PER_SECOND) * SAMPLE_RATE;
            expect(Math.abs(secondPress.frame! - expectedFrame)).toBeLessThanOrEqual(2);
        });

        it('lifts a pedal the dying pass left down when no row of the lane is in force at the loop start', async () => {
            // The lane's only row is the press at 3.5; nothing is in force at 2.
            loadClip([pedal('down', 127, 3.5)]);
            transportStoreState.value = playingState({ isLooping: true, loopStart: 2, loopEnd: 4 });
            startPlayheadScheduler();

            await runTicksUntil(() => schedulerSession.pendingSeam !== null);
            const seamFrame = frameOf(schedulerSession.pendingSeam!.seamAudioTime);

            expect(pedalCalls.map((call) => call.position)).toEqual([1, 0]);
            const release = pedalCalls[1]!;
            expect(Math.abs(release.frame! - seamFrame)).toBeLessThanOrEqual(1);
            expect(otherPedalCalls).toEqual([]);
        });

        it('lifts a pedal left down on a track that has no clip at the loop start', async () => {
            // The clip ends at 4 and the loop is [6, 8): the pedal pressed at 3.5 is
            // still down when the pass ends, and no clip of the track plays at 6.
            loadClip([pedal('down', 127, 3.5)]);
            const track = (trackStoreState.value!.tracks as { clips: { endBeat: number }[] }[])[0]!;
            track.clips[0]!.endBeat = 4;
            transportStoreState.value = playingState({ isLooping: true, loopStart: 6, loopEnd: 8 });
            startPlayheadScheduler();

            await runTicksUntil(() => schedulerSession.pendingSeam !== null);
            const seamFrame = frameOf(schedulerSession.pendingSeam!.seamAudioTime);

            expect(pedalCalls.map((call) => call.position)).toEqual([1, 0]);
            expect(Math.abs(pedalCalls[1]!.frame! - seamFrame)).toBeLessThanOrEqual(1);
        });

        it('emits a row sitting exactly on the loop start once', async () => {
            loadClip([pedal('up-0', 0, 0), pedal('down-at-2', 127, 2), pedal('up-6', 0, 6)]);
            transportStoreState.value = playingState({ isLooping: true, loopStart: 2, loopEnd: 4 });
            startPlayheadScheduler();

            await runTicksUntil(() => schedulerSession.pendingSeam !== null);
            const seamFrame = frameOf(schedulerSession.pendingSeam!.seamAudioTime);

            // Anything else at the seam frame (the carried up the row replaces,
            // sent as well) would reach the engine in the same frame as the row and
            // could win over it.
            const onSeamFrame = pedalCalls.filter((call) => Math.abs(call.frame! - seamFrame) <= 1);
            expect(onSeamFrame.map((call) => call.position)).toEqual([1]);
        });
    });

    describe('late loop wrap', () => {
        // A region shorter than the look-ahead cannot hand a pass over early, so it
        // wraps after the playhead crosses its end.
        const SHORT_LOOP = { loopStart: 3.4, loopEnd: 3.55 };

        function hasWrapped(previous: { beat: number }): () => boolean {
            return () => {
                const wrapped = schedulerSession.accumulatedPosition < previous.beat;
                previous.beat = schedulerSession.accumulatedPosition;
                return wrapped;
            };
        }

        it('restores the value in force at the loop start, with no lift ahead of it', async () => {
            loadClip(pedalLane());
            transportStoreState.value = playingState({ playheadPosition: 3.3, isLooping: true, ...SHORT_LOOP });
            startPlayheadScheduler();

            await runTicksUntil(hasWrapped({ beat: 3.3 }));

            // The pedal pressed at 3.5 inside the dying pass, then the wrap: the
            // framed restore of the up in force at 3.4 (the queued moves for the old
            // position are dropped by the discard, not superseded by a frameless
            // lift), and the incoming pass's own press at 3.5.
            expect(pedalCalls.map((call) => call.position)).toEqual([1, 0, 1]);
            const [, restore, secondPress] = pedalCalls;
            expect(restore!.frame).toBeDefined();
            expect(restore!.frame!).toBeLessThanOrEqual(frameOf(ctxTime.now));
            expect(restore!.frame!).toBeGreaterThan(frameOf(ctxTime.now - 2 * TICK_SECONDS));
            expect(secondPress!.frame!).toBeGreaterThan(restore!.frame!);
        });

        it('lifts and does not restore when no row of the lane is in force at the loop start', async () => {
            loadClip([pedal('down', 127, 3.5)]);
            transportStoreState.value = playingState({ playheadPosition: 3.3, isLooping: true, ...SHORT_LOOP });
            startPlayheadScheduler();

            await runTicksUntil(hasWrapped({ beat: 3.3 }));

            // The press, the framed lift at the wrap (nothing is in force, so the
            // pedal is lifted rather than restored), and the new pass's own press.
            expect(pedalCalls.map((call) => call.position)).toEqual([1, 0, 1]);
            expect(pedalCalls[1]!.frame).toBeDefined();
            expect(pedalCalls[1]!.frame!).toBeLessThanOrEqual(frameOf(ctxTime.now));
        });
    });

    describe('follow-action jump', () => {
        async function playUntilPedalDown(): Promise<void> {
            await runTicksUntil(() => pedalCalls.some((call) => call.position === 1), 50);
        }

        it('restores the value in force at the jump destination at the jump frame', async () => {
            loadClip(pedalLane());
            transportStoreState.value = playingState({ playheadPosition: 3.2 });
            startPlayheadScheduler();
            await playUntilPedalDown();
            pedalCalls.length = 0;

            evaluateFollowActionsMock.mockImplementationOnce(() => ({ jumpToPosition: 2, shouldStop: false }));
            await runTick();

            // Only the up that is in force at 2, at the jump frame: no frameless lift first.
            expect(pedalCalls).toEqual([{ position: 0, frame: frameOf(ctxTime.now) }]);
        });

        it('lifts and does not restore when no row of the lane is in force at the destination', async () => {
            loadClip([pedal('down', 127, 3.5)]);
            transportStoreState.value = playingState({ playheadPosition: 3.2 });
            startPlayheadScheduler();
            await playUntilPedalDown();
            pedalCalls.length = 0;

            evaluateFollowActionsMock.mockImplementationOnce(() => ({ jumpToPosition: 2, shouldStop: false }));
            await runTick();

            // Nothing is in force at 2, so the pedal stored playback moved is lifted at the jump frame.
            expect(pedalCalls).toEqual([{ position: 0, frame: frameOf(ctxTime.now) }]);
            expect(otherPedalCalls).toEqual([]);
        });

        it('emits a row sitting exactly on the destination once', async () => {
            loadClip([pedal('up-0', 0, 0), pedal('down', 127, 2)]);
            transportStoreState.value = playingState({ playheadPosition: 1.9 });
            startPlayheadScheduler();
            await playUntilPedalDown();
            pedalCalls.length = 0;

            evaluateFollowActionsMock.mockImplementationOnce(() => ({ jumpToPosition: 2, shouldStop: false }));
            await runTick();

            // Only the row: a carried up sent beside it, in the same frame, could win over it.
            expect(framedCalls()).toEqual([{ position: 1, frame: frameOf(ctxTime.now) }]);
        });
    });

    describe('transport start', () => {
        it('posts nothing for a start at beat 2: chasing the value in force is not a relocation', async () => {
            loadClip(pedalLane());
            transportStoreState.value = playingState({ playheadPosition: 2 });
            startPlayheadScheduler();

            await runTick();
            await runTick();

            expect(pedalCalls).toEqual([]);
            expect(otherPedalCalls).toEqual([]);
        });
    });
});
