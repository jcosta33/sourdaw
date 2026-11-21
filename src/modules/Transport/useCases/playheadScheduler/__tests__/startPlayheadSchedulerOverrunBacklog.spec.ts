import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { applyAutomation } from '../../scheduling/applyAutomation/applyAutomation';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { schedulerTimingDiagnostics } from '../schedulerTimingDiagnostics';
import { startPlayheadScheduler } from '../startPlayheadScheduler';
import { stopPlayheadScheduler } from '../stopPlayheadScheduler';

/**
 * #6823 — the scheduler Worker posts a tick every grain whatever the main
 * thread is doing. A tick that runs synchronously past the grain blocks the
 * thread, the Worker keeps posting, and each message it posted meanwhile waits
 * in the queue. Running a full tick for every one of them, back to back, means
 * a per-tick cost above the grain never lets the thread back to the event loop
 * and the renderer stops answering. A message sent before the last tick
 * settled was queued behind that tick: the scheduler drops it, and the next
 * message the Worker posts after settlement runs at most one grain later and
 * catches up through the stall-skip window logic.
 *
 * The Worker is a capture-only stand-in so the spec posts the queued backlog
 * itself, each message its own task as the browser delivers it. One clock
 * drives `performance.now()` and the audio context; one tick's scheduling work
 * advances it three grains to stand in for a synchronous overrun.
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
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        getCrdtDoc: actual.getCrdtDoc,
        captureProjectRootIdentity: vi.fn<typeof import('#/modules/CrdtDocument/useCases').captureProjectRootIdentity>(
            () => 'root-identity'
        ),
    };
});
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        sanitizeTrackSnapshot: actual.sanitizeTrackSnapshot,
        addWarpMarker: actual.addWarpMarker,
        readMusicalRange: actual.readMusicalRange,
        readMusicalRangeInputs: actual.readMusicalRangeInputs,
        clampDeviceParamWrite: actual.clampDeviceParamWrite,
        clipHasActiveGainEnvelope: actual.clipHasActiveGainEnvelope,
        deriveEffectiveAudibility: actual.deriveEffectiveAudibility,
        deriveVcaMultiplier: actual.deriveVcaMultiplier,
        getGainEnvelopeSeries: actual.getGainEnvelopeSeries,
        getStoredWarpState: actual.getStoredWarpState,
        getVcaGroupsState: actual.getVcaGroupsState,
        getWarpState: actual.getWarpState,
        setWarpState: actual.setWarpState,
        shouldCreateLiveTrackStrip: actual.shouldCreateLiveTrackStrip,
        soloModeStore: actual.soloModeStore,
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
        appendClipToTrack: vi.fn(),
        clipSelectionStore: { value: null },
        resolveEligibleClipWriteTarget: vi.fn(),
        updateClipInStore: vi.fn(),
    };
});
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
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        buildOfflineModulatorPlans: actual.buildOfflineModulatorPlans,
        getAutomationLaneCeiling: actual.getAutomationLaneCeiling,
        startAutomationRecording: vi.fn(),
        stopAutomationRecording: vi.fn(),
        applyModulation: vi.fn(),
        applyModulationToEngine: vi.fn(),
        getAutomationValueAtBeat: vi.fn(() => null),
        isRecordingAutomation: vi.fn(() => false),
    };
});
vi.mock('#/modules/Arrangement/useCases', () => ({
    captureRecordingCommitRetirement: () => {
        throw new Error('This timer fixture must not publish a recording clip');
    },
    hasAutomaticRecordingMidiCapture: () => {
        throw new Error('The unreachable original out must remain admitted-open');
    },
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
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        findMidiTransformDevice: actual.findMidiTransformDevice,
        isMidiTransformDevice: actual.isMidiTransformDevice,
        isBypassedNoteReceiver: actual.isBypassedNoteReceiver,
        resolveDrumKitBy: actual.resolveDrumKitBy,
        resolveDrumKitOutputGain: actual.resolveDrumKitOutputGain,
        resolveLiveNoteControls: actual.resolveLiveNoteControls,
        resolveNoteReceivingInstrument: actual.resolveNoteReceivingInstrument,
        builtinSynthVoice: { read: vi.fn() },
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
        cancelTrackAutomationRamps: vi.fn(),
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
    };
});
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: () => null,
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
    getSynthParamsFromDevices: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        compileFaustDSP: actual.compileFaustDSP,
        createFaustNode: actual.createFaustNode,
        forgetRetiredPluginInstances: actual.forgetRetiredPluginInstances,
        getFaustModuleLatencyMs: actual.getFaustModuleLatencyMs,
        isFaustModule: actual.isFaustModule,
        markExternalPluginEngineAttached: actual.markExternalPluginEngineAttached,
        readExternalPluginStatesBeforeEngineRetire: actual.readExternalPluginStatesBeforeEngineRetire,
        registerBuiltinFaustDSP: actual.registerBuiltinFaustDSP,
        setPluginBypass: actual.setPluginBypass,
        setPluginParameter: actual.setPluginParameter,
        isFaustInstrumentModule: () => false,
    };
});
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
vi.mock('../../transportControls/panicYeastRuntime', () => ({
    panicYeastRuntime: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({ updateTransportState: vi.fn() }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: () => ({ jumpToPosition: null, shouldStop: false }),
}));

const GRAIN_MS = 10;
/** The synchronous overrun one tick's scheduling work stands in for. */
const OVERRUN_MS = 3 * GRAIN_MS;
const QUEUED_BACKLOG = 10;

/** Captures the scheduler's handler; the spec posts every tick message itself. */
class CapturingSchedulerWorker {
    static instance: CapturingSchedulerWorker | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor() {
        CapturingSchedulerWorker.instance = this;
    }

    postMessage(): void {}

    terminate(): void {
        CapturingSchedulerWorker.instance = null;
    }

    addEventListener(): void {}

    removeEventListener(): void {}
}

let sequence = 0;

function epochMs(clockMs: number): number {
    return performance.timeOrigin + clockMs;
}

/**
 * Deliver one tick message the Worker sent at `sentAtClockMs`, as its own task,
 * and wait until whatever it started has settled.
 */
async function deliverTick(sentAtClockMs: number): Promise<void> {
    const worker = CapturingSchedulerWorker.instance;
    if (!worker?.onmessage) {
        throw new Error('The scheduler has no Worker handler to deliver to');
    }
    sequence += 1;
    worker.onmessage(
        new MessageEvent('message', {
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence,
                scheduledAtMs: epochMs(sentAtClockMs),
                sentAtMs: epochMs(sentAtClockMs),
            },
        })
    );
    await vi.waitFor(() => expect(schedulerSession.tickInFlight).toBe(false), { interval: 1 });
}

/** The next tick's scheduling work blocks the thread for `workMs`. */
function blockNextTick(workMs: number): void {
    vi.mocked(applyAutomation).mockImplementationOnce(() => {
        clock.ms += workMs;
        return new Set<string>();
    });
}

function playing(): typeof defaultTransportState {
    return { ...defaultTransportState, isPlaying: true, tempo: 120, scheduleGrainMs: GRAIN_MS, playheadPosition: 0 };
}

/** Run one tick whose work blocks for `workMs` and return the clock span it blocked. */
async function runBlockingTick(workMs: number): Promise<{ startedMs: number; settledMs: number }> {
    clock.ms += GRAIN_MS;
    const startedMs = clock.ms;
    blockNextTick(workMs);
    await deliverTick(startedMs);
    expect(clock.ms).toBe(startedMs + workMs);
    return { startedMs, settledMs: clock.ms };
}

function runOverrunningTick(): Promise<{ startedMs: number; settledMs: number }> {
    return runBlockingTick(OVERRUN_MS);
}

describe('startPlayheadScheduler after a tick overruns the grain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tempoMapStoreState.value = { changes: [] };
        midiStoreState.value = null;
        trackStoreState.value = { tracks: [] };
        clock.ms = 1_000;
        sequence = 0;
        disposePlayheadScheduler();
        vi.spyOn(performance, 'now').mockImplementation(() => clock.ms);
        vi.stubGlobal('Worker', CapturingSchedulerWorker);
        transportStoreState.value = playing();
    });

    afterEach(() => {
        disposePlayheadScheduler();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('drops the messages queued behind the overrunning tick instead of running a full tick for each', async () => {
        startPlayheadScheduler();
        const { startedMs } = await runOverrunningTick();
        const ticksBefore = vi.mocked(applyAutomation).mock.calls.length;
        const settledBefore = schedulerTimingDiagnostics.snapshot().ticksSettled;

        // Every grain of the blocked span the Worker kept posting, delivered
        // once the thread is free, each as its own task.
        for (let queued = 0; queued < QUEUED_BACKLOG; queued++) {
            await deliverTick(startedMs + (queued * (OVERRUN_MS - 2)) / QUEUED_BACKLOG);
        }

        const timing = schedulerTimingDiagnostics.snapshot();
        expect(vi.mocked(applyAutomation).mock.calls.length - ticksBefore).toBe(0);
        expect(timing.ticksSettled - settledBefore).toBe(0);
        expect(timing.ticksSkippedBehindOverrun).toBe(QUEUED_BACKLOG);
        expect(timing.messagesReceived).toBe(1 + QUEUED_BACKLOG);
    });

    it('drops a message sent just before a five-grain overrun settled', async () => {
        startPlayheadScheduler();
        const { settledMs } = await runBlockingTick(5 * GRAIN_MS);
        const ticksBefore = vi.mocked(applyAutomation).mock.calls.length;

        await deliverTick(settledMs - 0.5);

        expect(vi.mocked(applyAutomation).mock.calls.length - ticksBefore).toBe(0);
        expect(schedulerTimingDiagnostics.snapshot().ticksSkippedBehindOverrun).toBe(1);
    });

    it('admits a message sent before a tick that stayed inside the grain settled', async () => {
        startPlayheadScheduler();
        const { startedMs } = await runBlockingTick(GRAIN_MS / 2);
        const ticksBefore = vi.mocked(applyAutomation).mock.calls.length;

        await deliverTick(startedMs + 1);

        expect(vi.mocked(applyAutomation).mock.calls.length - ticksBefore).toBe(1);
        expect(schedulerTimingDiagnostics.snapshot().ticksSkippedBehindOverrun).toBe(0);
    });

    it('runs the first message the Worker sent after the overrunning tick settled', async () => {
        startPlayheadScheduler();
        const { startedMs, settledMs } = await runOverrunningTick();
        await deliverTick(startedMs + GRAIN_MS);
        const ticksBefore = vi.mocked(applyAutomation).mock.calls.length;

        clock.ms = settledMs + GRAIN_MS / 2;
        await deliverTick(settledMs + GRAIN_MS / 2);

        expect(vi.mocked(applyAutomation).mock.calls.length - ticksBefore).toBe(1);
        expect(schedulerSession.lastTickTime).toBe((settledMs + GRAIN_MS / 2) / 1000);
        expect(schedulerTimingDiagnostics.snapshot().ticksSkippedBehindOverrun).toBe(1);
    });

    it('runs the first tick of a new session whatever the previous session settled at', async () => {
        startPlayheadScheduler();
        const { startedMs } = await runOverrunningTick();
        stopPlayheadScheduler();
        transportStoreState.value = playing();
        startPlayheadScheduler();
        const ticksBefore = vi.mocked(applyAutomation).mock.calls.length;

        // Sent inside the previous session's blocked span: only a settled
        // marker carried across the restart could drop it.
        await deliverTick(startedMs + GRAIN_MS);

        expect(vi.mocked(applyAutomation).mock.calls.length - ticksBefore).toBe(1);
        expect(schedulerTimingDiagnostics.snapshot().ticksSkippedBehindOverrun).toBe(0);
    });
});
