import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { startRecording } from '#/modules/Arrangement/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import '../../../workers/schedulerWorker';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { schedulerTimingDiagnostics } from '../schedulerTimingDiagnostics';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * #5889 — a punch loop recording froze just before its first loop seam: the
 * transport still read playing, no tick was in flight, the last tick sat a
 * grain before a pending seam, and the wrap count stayed at 1 for the rest of
 * the take. The scheduler is driven by the Worker's repeating timer, so the
 * chain can only stop when the main thread stops admitting the Worker's ticks.
 *
 * This spec runs the REAL scheduler Worker module against the REAL scheduler,
 * joined by a synchronous message bridge, under one fake clock that also
 * drives the audio context. The Worker's `setInterval` is replaced by a
 * repeating timer that keeps the cadence Blink's `TimerBase` documents: after
 * each firing the next fire time is `now + interval / 20` snapped to the
 * timer's own tick grid, so a late wake skips grid slots rather than drifting.
 * The grid sits a fixed phase after the deadline the Worker computes when it
 * arms; the producer must tolerate any such phase.
 *
 * One wake ten milliseconds before the seam lands after the Worker's next
 * deadline but before the timer's next grid slot. The Worker counts a missed
 * slot the timer did not skip, so every later callback fires before the
 * deadline the Worker publishes. The consumer rejects a future-dated deadline;
 * a producer that still advanced its deadline on those early callbacks kept
 * that offset forever and starved the scheduler of every later tick.
 */

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const midiStoreState: {
    value: { notesByClipId: Record<string, unknown[]>; probabilitySeed: number } | null;
} = { value: null };
/** One clock for `performance.now()` and the audio context, in milliseconds. */
const clock = { ms: 0 };

const audioContextStub = {
    sampleRate: 48000,
    get currentTime() {
        return clock.ms / 1000;
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
vi.mock('#/modules/Arrangement/stores', () => ({
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
    takeLaneStore: { value: { lanes: [] } },
    activeRecordingRef: { current: [] },
    // Pulled in transitively: the scheduler reaches Levain's param bridge, whose
    // dependency bundle destructures these off this barrel at module scope. A
    // factory that omits them fails the whole file at import, not at a test.
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
    startRecording: vi.fn(() => [] as { trackId: string; id: string }[]),
    // The real `stopRecording` is async: its promise is the take's commit, which
    // the recording lifecycle tracks.
    stopRecording: vi.fn(() => Promise.resolve()),
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
    getCurrentTime: () => clock.ms / 1000,
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
    // No native engine: the cursor follows the scheduler's own integration.
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
/** The issue's arrangement: loop bars 3–4, punch from beat 10 past the loop end. */
const LOOP_START_BEAT = 8;
const LOOP_END_BEAT = 12;
const PUNCH_IN_BEAT = 10;
const PUNCH_OUT_BEAT = 14;
/**
 * The roll starts at the loop start on audio time 0, so pass N ends at 2N s.
 * The issue's stall came after the first wrap, before the second seam.
 */
const SECOND_SEAM_MS = 4000;
const GRAIN_MS = 10;
/** Where the timer's tick grid sits after the Worker's first deadline. */
const TIMER_PHASE_MS = 2;
/** Ordinary wake latency past a grid slot: every ordinary tick is 3 ms late. */
const STEADY_WAKE_MS = 1;
/**
 * The one slow wake, about ten milliseconds before the second seam. It lands
 * past the Worker's next deadline (phase + wake > grain) yet before the timer's
 * next grid slot (wake + grain / 20 <= grain), so the timer keeps that slot.
 */
const SLOW_WAKE_MS = 8.5;
const SLOW_WAKE_GRID_MS = SECOND_SEAM_MS - 2 * GRAIN_MS + TIMER_PHASE_MS;
/** Run on past the second seam, into the third pass. */
const DRIVE_END_MS = 4500;

type RepeatingTimer = { callback: () => void; intervalMs: number; nextFireMs: number };

let timer: RepeatingTimer | null = null;

function snapToNextTick(timeMs: number, tickPhaseMs: number, intervalMs: number): number {
    return tickPhaseMs + Math.ceil((timeMs - tickPhaseMs) / intervalMs) * intervalMs;
}

/** Fire the timer's next grid slot after `wakeMs` of wake latency, Blink's way. */
function fireTimer(active: RepeatingTimer, wakeMs: number): void {
    const gridMs = active.nextFireMs;
    clock.ms = gridMs + wakeMs;
    active.nextFireMs = snapToNextTick(clock.ms + active.intervalMs / 20, gridMs, active.intervalMs);
    active.callback();
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Stands in for the dedicated Worker: commands go to the Worker module's
 * `self.onmessage` and its `self.postMessage` ticks come back here.
 */
class BridgedSchedulerWorker {
    static instance: BridgedSchedulerWorker | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor() {
        BridgedSchedulerWorker.instance = this;
    }

    postMessage(data: unknown): void {
        self.onmessage?.(new MessageEvent('message', { data }));
    }

    terminate(): void {
        BridgedSchedulerWorker.instance = null;
    }

    addEventListener(): void {}

    removeEventListener(): void {}
}

function playingPunchLoop(): typeof defaultTransportState {
    return {
        ...defaultTransportState,
        isPlaying: true,
        tempo: TEMPO_BPM,
        scheduleGrainMs: GRAIN_MS,
        playheadPosition: LOOP_START_BEAT,
        isLooping: true,
        loopStart: LOOP_START_BEAT,
        loopEnd: LOOP_END_BEAT,
        punchInEnabled: true,
        punchInBeat: PUNCH_IN_BEAT,
        punchOutBeat: PUNCH_OUT_BEAT,
    };
}

function schedulerState(): string {
    const timing = schedulerTimingDiagnostics.snapshot();
    return JSON.stringify({
        wrapCount: playheadWrapCountRef.current,
        tickInFlight: schedulerSession.tickInFlight,
        lastTickSeconds: schedulerSession.lastTickTime,
        pendingSeamSeconds: schedulerSession.pendingSeam?.seamAudioTime ?? null,
        accumulatedPosition: schedulerSession.accumulatedPosition,
        admittedTicks: timing.messagesReceived,
        settledTicks: timing.ticksSettled,
        clockSeconds: clock.ms / 1000,
    });
}

describe('startPlayheadScheduler under a phase-shifted Worker timer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tempoMapStoreState.value = { changes: [] };
        midiStoreState.value = null;
        trackStoreState.value = {
            tracks: [{ id: 'rec-1', armed: true, kind: 'audio', inputId: 'dev-punch', clips: [] }],
        };
        metronomeSchedulingState.lastBeat = -1;
        metronomeSchedulingState.firedClickTimes.clear();
        clock.ms = 0;
        timer = null;
        disposePlayheadScheduler();
        vi.spyOn(performance, 'now').mockImplementation(() => clock.ms);
        vi.stubGlobal('setInterval', (callback: () => void, intervalMs: number) => {
            timer = { callback, intervalMs, nextFireMs: clock.ms + intervalMs + TIMER_PHASE_MS };
            return 1;
        });
        vi.stubGlobal('clearInterval', () => {
            timer = null;
        });
        vi.stubGlobal('postMessage', (data: unknown) => {
            BridgedSchedulerWorker.instance?.onmessage?.(new MessageEvent('message', { data }));
        });
        vi.stubGlobal('Worker', BridgedSchedulerWorker);
    });

    afterEach(() => {
        disposePlayheadScheduler();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('keeps ticking across the seam after a slow wake lands between deadline and grid slot', async () => {
        transportStoreState.value = playingPunchLoop();

        startPlayheadScheduler();
        let slowWakeFired = false;
        while (clock.ms < DRIVE_END_MS) {
            const active = timer;
            expect(active, 'the Worker stopped its repeating timer').not.toBeNull();
            if (!active) {
                return;
            }
            const slowWake = !slowWakeFired && active.nextFireMs >= SLOW_WAKE_GRID_MS;
            slowWakeFired ||= slowWake;
            fireTimer(active, slowWake ? SLOW_WAKE_MS : STEADY_WAKE_MS);
            await settle();
        }

        // The punch recording opened on the first pass and is still capturing.
        expect(vi.mocked(startRecording).mock.calls.map(([anchorBeat]) => anchorBeat)).toEqual([PUNCH_IN_BEAT]);
        expect(schedulerSession.punchRecordingActive).toBe(true);
        // The scheduler crossed both seams and is still ticking on the third pass.
        expect(playheadWrapCountRef.current, schedulerState()).toBe(2);
        expect(schedulerSession.lastTickTime, schedulerState()).toBeGreaterThan((DRIVE_END_MS - 2 * GRAIN_MS) / 1000);
        expect(schedulerSession.accumulatedPosition, schedulerState()).toBeGreaterThanOrEqual(LOOP_START_BEAT);
        expect(schedulerSession.accumulatedPosition, schedulerState()).toBeLessThan(LOOP_END_BEAT);
    });
});
