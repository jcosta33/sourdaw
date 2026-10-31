import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeRecordingRef } from '#/modules/Arrangement/stores';
import { type stageRecordingTake } from '#/modules/Arrangement/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * A follow action or a loop edit that supersedes a MIDI loop recording's
 * scheduled seam ends the pass it interrupts. Notes are tagged with the wrap
 * count when they arrive (`captureEventBeat`), and the raw pass filters and
 * the source mapping read a take's notes by that tag, so the supersession
 * must close exactly one pass and leave the wrap count naming the pass that
 * follows it. `stageRecordingTake` is modelled on the lane it writes: an
 * ordinary staging closes a new pass and advances the open take, a staging
 * naming `replacedTakeId` retimes that take in place.
 */

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
    createGain: () => ({ connect: () => {} }),
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
const takeLaneState = vi.hoisted(() => ({
    value: { lanes: [] as { id: string; trackId: string; takes: StagedTake[]; activeCompRegions: unknown[] }[] },
}));
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    // The real barrel supplies `activeRecordingRef`, which the scheduler and
    // these assertions must share.
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    adjustmentLayerStore: { value: null },
    gainEnvelopeStore: { value: null },
    getTrackEligibility: vi.fn(),
    markerStore: { value: null },
    vcaGroupStore: { value: null },
    warpStateStore: { value: null },
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: takeLaneState,
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
const stageSpy = vi.hoisted(() => vi.fn<(input: Parameters<typeof stageRecordingTake>[0]) => undefined>());
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
    stageRecordingTake: stageSpy,
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
    scheduleClick: vi.fn(),
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
    createBufferSource: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    // No native engine here: the cursor these seams are about follows the
    // scheduler's own integration.
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
    hydrateYeastCrdtProjection: vi.fn(),

    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
// scheduleMetronome and resetMetronomeBeat run for real: the seam anchor is
// their window boundary too, and the click dedup they rely on is exactly the
// thing a wider window can defeat.
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
/** Deliberately not a divisor of the 2 s loop, so no tick lands on a seam. */
const TICK_SECONDS = 0.07;
const LOOP_BEATS = 4;
const CLIP_ID = 'recording-clip';
const JUMP_TARGET_BEAT = 1;

type StagedTake = {
    id: string;
    clipId: string;
    startBeat: number;
    endBeat: number;
    sourceOffsetBeats?: number;
    recordingPassIndex?: number;
};

function lane(): { takes: StagedTake[] } {
    const recordingLane = takeLaneState.value.lanes[0];
    if (!recordingLane) {
        throw new Error('Expected the recording take lane');
    }
    return recordingLane;
}

function stageIntoLane(input: Parameters<typeof stageRecordingTake>[0]): undefined {
    const { recordingPassIndex } = input;
    if (recordingPassIndex === undefined) {
        throw new Error('Expected a MIDI pass identity');
    }
    const takes = lane().takes;
    if (input.replacedTakeId !== undefined) {
        lane().takes = takes.map((take) => {
            if (take.id !== input.replacedTakeId) {
                return take;
            }
            return { ...take, endBeat: input.endBeat, recordingPassIndex };
        });
        return undefined;
    }
    lane().takes = [
        ...takes.map((take) => {
            if (take.sourceOffsetBeats !== undefined || take.clipId !== input.clipId) {
                return take;
            }
            return { ...take, recordingPassIndex: recordingPassIndex + 1 };
        }),
        {
            id: `take-${takes.length}`,
            clipId: input.clipId,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            sourceOffsetBeats: input.sourceOffsetBeats,
            recordingPassIndex,
        },
    ];
    return undefined;
}

function closedPasses(): StagedTake[] {
    return lane().takes.filter((take) => take.sourceOffsetBeats !== undefined);
}

function openTake(): StagedTake {
    const open = lane().takes.find((take) => take.sourceOffsetBeats === undefined);
    if (!open) {
        throw new Error('Expected the open recording take');
    }
    return open;
}

/** The pass a note arriving now is tagged with, relative to this recording. */
function notePass(): number {
    return playheadWrapCountRef.current - activeRecordingRef.startWrapCount;
}

let tickSequence = 0;

async function tick(seconds = TICK_SECONDS): Promise<void> {
    tickSequence++;
    ctxTime.now += seconds;
    const receivedAtMs = performance.timeOrigin + performance.now();
    const worker = schedulerSession.worker as unknown as { onmessage: ((event: { data: unknown }) => void) | null };
    worker.onmessage?.({
        data: {
            type: 'tick',
            generation: schedulerSession.generation,
            sequence: tickSequence,
            scheduledAtMs: receivedAtMs - 2,
            sentAtMs: receivedAtMs - 1,
        },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function advanceUntil(condition: () => boolean): Promise<void> {
    for (let ticks = 0; !condition(); ticks++) {
        if (ticks > 200) {
            throw new Error('Scheduler never reached the expected state');
        }
        await tick();
    }
}

async function jumpOnNextTick(seconds: number): Promise<number> {
    const passPosition = schedulerSession.accumulatedPosition;
    evaluateFollowActionsMock.mockImplementationOnce(() => ({ jumpToPosition: JUMP_TARGET_BEAT, shouldStop: false }));
    await tick(seconds);
    return passPosition;
}

describe('superseded loop seam during MIDI loop recording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stageSpy.mockReset();
        stageSpy.mockImplementation(stageIntoLane);
        evaluateFollowActionsMock.mockImplementation(() => ({ jumpToPosition: null, shouldStop: false }));
        tempoMapStoreState.value = { changes: [] };
        midiStoreState.value = { notesByClipId: {}, probabilitySeed: 1 };
        ctxTime.now = 0;
        tickSequence = 0;
        disposePlayheadScheduler();
        trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    kind: 'midi',
                    muted: false,
                    armed: true,
                    parentId: null,
                    followChordTrack: false,
                    automationMode: 'read',
                    devices: [],
                    clips: [
                        {
                            id: CLIP_ID,
                            type: 'midi',
                            muted: false,
                            startBeat: 0,
                            endBeat: 64,
                            gain: 1,
                            loopEnabled: false,
                            midiOffsetBeats: 0,
                        },
                    ],
                    freezeState: { status: 'unfrozen', frozenBufferId: null },
                },
            ],
        };
        takeLaneState.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [{ id: 'open-take', clipId: CLIP_ID, startBeat: 0, endBeat: 0, recordingPassIndex: 0 }],
                    activeCompRegions: [],
                },
            ],
        };
        activeRecordingRef.current = [CLIP_ID];
        activeRecordingRef.startWrapCount = 0;
        activeRecordingRef.loopStart = 0;
        activeRecordingRef.loopEnd = LOOP_BEATS;
        activeRecordingRef.startedLooping = true;
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
        transportStoreState.value = {
            ...defaultTransportState,
            isPlaying: true,
            tempo: TEMPO_BPM,
            playheadPosition: 0,
            isLooping: true,
            loopStart: 0,
            loopEnd: LOOP_BEATS,
            isRecording: true,
        };
        startPlayheadScheduler();
    });

    afterEach(() => {
        disposePlayheadScheduler();
        activeRecordingRef.current = [];
        vi.unstubAllGlobals();
    });

    it('retimes the planned pass end and tags later notes with the pass that holds them', async () => {
        await advanceUntil(() => schedulerSession.pendingSeam !== null);
        expect(closedPasses()).toEqual([expect.objectContaining({ recordingPassIndex: 0, endBeat: LOOP_BEATS })]);
        const jumpTickSeconds = 0.01;
        expect(ctxTime.now + jumpTickSeconds).toBeLessThan(schedulerSession.pendingSeam!.seamAudioTime);

        const endingBeat = await jumpOnNextTick(jumpTickSeconds);

        expect(schedulerSession.pendingSeam).toBeNull();
        expect(closedPasses()).toEqual([expect.objectContaining({ recordingPassIndex: 0 })]);
        expect(closedPasses()[0]!.endBeat).toBeGreaterThan(endingBeat);
        expect(closedPasses()[0]!.endBeat).toBeLessThan(LOOP_BEATS);
        expect(openTake().recordingPassIndex).toBe(1);
        expect(notePass()).toBe(1);

        await advanceUntil(() => closedPasses().length === 2);
        expect(closedPasses()[1]).toMatchObject({ recordingPassIndex: 1 });
        // Notes played after the jump and before this seam sounds carry the
        // tag of the take that has just closed over them.
        expect(notePass()).toBe(1);
        await advanceUntil(() => schedulerSession.pendingSeam === null);
        expect(notePass()).toBe(2);
        expect(openTake().recordingPassIndex).toBe(2);
    });

    it('retimes the planned pass end when a loop edit cancels the seam before it sounds', async () => {
        await advanceUntil(() => schedulerSession.pendingSeam !== null);
        const passPosition = schedulerSession.accumulatedPosition;
        const editTickSeconds = 0.01;
        expect(ctxTime.now + editTickSeconds).toBeLessThan(schedulerSession.pendingSeam!.seamAudioTime);
        const extendedLoopEnd = LOOP_BEATS + 2;
        transportStoreState.value = { ...transportStoreState.value!, loopEnd: extendedLoopEnd };

        await tick(editTickSeconds);

        expect(schedulerSession.pendingSeam).toBeNull();
        expect(closedPasses()).toEqual([expect.objectContaining({ recordingPassIndex: 0 })]);
        expect(closedPasses()[0]!.endBeat).toBeGreaterThan(passPosition);
        expect(closedPasses()[0]!.endBeat).toBeLessThan(LOOP_BEATS);
        expect(openTake().recordingPassIndex).toBe(1);
        expect(notePass()).toBe(1);
    });

    it('counts one pass when a loop edit behind the playhead wraps at the edit', async () => {
        await advanceUntil(() => schedulerSession.pendingSeam !== null);
        transportStoreState.value = { ...transportStoreState.value!, loopEnd: LOOP_BEATS - 1 };

        await tick(0.01);

        expect(closedPasses()).toEqual([expect.objectContaining({ recordingPassIndex: 0 })]);
        expect(openTake().recordingPassIndex).toBe(1);
        expect(notePass()).toBe(1);
    });

    it('closes the pass once when a tempo edit replans the seam before it sounds', async () => {
        await advanceUntil(() => schedulerSession.pendingSeam !== null);
        const editTickSeconds = 0.01;
        expect(ctxTime.now + editTickSeconds).toBeLessThan(schedulerSession.pendingSeam!.seamAudioTime);
        transportStoreState.value = { ...transportStoreState.value!, tempo: TEMPO_BPM - 20 };

        await tick(editTickSeconds);
        await advanceUntil(() => notePass() === 1);

        expect(closedPasses()).toEqual([expect.objectContaining({ recordingPassIndex: 0, endBeat: LOOP_BEATS })]);
        expect(openTake().recordingPassIndex).toBe(1);
    });

    it('closes the sounded pass and the interrupted one when the seam instant passed uncounted', async () => {
        await advanceUntil(() => schedulerSession.pendingSeam !== null);
        await advanceUntil(() => ctxTime.now + TICK_SECONDS >= schedulerSession.pendingSeam!.seamAudioTime);
        expect(notePass()).toBe(0);

        await jumpOnNextTick(TICK_SECONDS);

        expect(closedPasses().map((take) => take.recordingPassIndex)).toEqual([0, 1]);
        expect(closedPasses()[0]!.endBeat).toBe(LOOP_BEATS);
        expect(openTake().recordingPassIndex).toBe(2);
        expect(notePass()).toBe(2);
    });
});
