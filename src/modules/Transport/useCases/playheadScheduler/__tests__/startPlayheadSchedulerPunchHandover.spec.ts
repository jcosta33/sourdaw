import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { pausePlayback } from '../../transportControls/pausePlayback';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

/**
 * Punch ownership across a Pause handover (#5272). Pause stops the open punch
 * recording and defers its scheduler teardown until the recorder flush
 * settles; a Play that lands inside that window starts a new scheduler
 * generation, and the stale continuation then skips the teardown — which was
 * the only route retiring `punchRecordingActive`. The successor inherited a
 * punch it never opened and refused to open its own. The real `pausePlayback`
 * and the real scheduler drive every case; only the recorder flush, the
 * engine, and the stores are stand-ins.
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
    baseLatency: 0,
    outputLatency: 0,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({
        connect: () => {},
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

/** The recorder flush Pause awaits, held captive until a case releases it. */
const heldFlush = vi.hoisted(() => ({
    pending: null as Promise<void> | null,
    release: null as (() => void) | null,
    prime(): void {
        this.pending = new Promise<void>((resolve) => {
            this.release = () => {
                this.pending = null;
                this.release = null;
                resolve();
            };
        });
    },
}));

const startAudioRecordingSpy = vi.hoisted(() =>
    vi.fn<(trackId: string) => Promise<boolean>>(() => Promise.resolve(true))
);

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
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
    discardRecording: vi.fn(),
    // The punched clip the recorder opens; the audio arm then starts the
    // recorder for the armed track that owns it. `stopRecording` resolves the
    // commit the teardown hands the recording lifecycle.
    startRecording: vi.fn(() => [{ id: 'rec-punch', trackId: 'audio-1', startBeat: 10, endBeat: 11 }]),
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
    stopNativeLiveGraphSession: vi.fn(() => Promise.resolve()),
    startAudioRecording: startAudioRecordingSpy,
    stopAudioRecording: vi.fn(() => Promise.resolve()),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    createBufferSource: () => ({
        buffer: null,
        connect: () => {},
        playbackRate: { value: 1 },
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
    }),
    getCachedAudioBuffer: () => null,
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
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));
// Pause awaits the recorder flush through this call; the held promise is the
// window a Play can land in.
vi.mock('../../transportControls/stopActiveRecording', () => ({
    stopActiveRecording: vi.fn(() => heldFlush.pending ?? Promise.resolve()),
}));
// Applied rather than stubbed: Pause's own `isPlaying: false` write, and the
// punch-in's `isRecording: true`, are what the continuation and the next
// punch-in read back.
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: (patch: Partial<typeof defaultTransportState>) => {
        if (transportStoreState.value) {
            transportStoreState.value = { ...transportStoreState.value, ...patch };
        }
    },
}));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: () => ({ jumpToPosition: null, shouldStop: false }),
}));

const TEMPO_BPM = 120;
const TICK_SECONDS = 0.07;
const PUNCH_IN_BEAT = 10;
const PUNCH_OUT_BEAT = 14;

function armedAudioTrack(): unknown {
    return {
        id: 'audio-1',
        kind: 'audio',
        muted: false,
        armed: true,
        sends: [],
        clips: [],
        inputId: null,
        freezeState: { status: 'unfrozen' },
    };
}

function punchingState(overrides: Partial<typeof defaultTransportState> = {}): typeof defaultTransportState {
    return {
        ...defaultTransportState,
        isPlaying: true,
        isRecording: false,
        tempo: TEMPO_BPM,
        playheadPosition: 0,
        punchInEnabled: true,
        punchInBeat: PUNCH_IN_BEAT,
        punchOutBeat: PUNCH_OUT_BEAT,
        countInEnabled: false,
        ...overrides,
    };
}

type SchedulerWorkerHarness = { onmessage: ((event: { data: unknown }) => void) | null };

let schedulerTickSequence = 0;

function emitSchedulerTick(worker: SchedulerWorkerHarness): void {
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
}

async function settle(): Promise<void> {
    for (let round = 0; round < 6; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

async function runTick(worker: SchedulerWorkerHarness): Promise<void> {
    ctxTime.now += TICK_SECONDS;
    emitSchedulerTick(worker);
    await settle();
}

function schedulerWorker(): SchedulerWorkerHarness {
    return schedulerSession.worker as unknown as SchedulerWorkerHarness;
}

/** Tick the live scheduler until the playhead stands inside the punch region. */
async function runIntoPunchRegion(): Promise<void> {
    const worker = schedulerWorker();
    let ticks = 0;
    while (schedulerSession.accumulatedPosition < PUNCH_IN_BEAT + 0.5 && ticks < 400) {
        ticks++;
        await runTick(worker);
    }
    expect(schedulerSession.accumulatedPosition).toBeGreaterThanOrEqual(PUNCH_IN_BEAT + 0.5);
}

describe('punch ownership across a Pause handover (issue #5272)', () => {
    beforeEach(() => {
        ctxTime.now = 0;
        schedulerTickSequence = 0;
        transportStoreState.value = punchingState();
        trackStoreState.value = { tracks: [armedAudioTrack()] };
        midiStoreState.value = { notesByClipId: {}, probabilitySeed: 1 };
        startAudioRecordingSpy.mockClear();
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
        heldFlush.release?.();
        disposePlayheadScheduler();
        vi.unstubAllGlobals();
    });

    it('lets the successor roll open its own punch when Play lands before the old flush settles', async () => {
        startPlayheadScheduler();
        const pausedGeneration = schedulerSession.generation;
        await runIntoPunchRegion();
        expect(startAudioRecordingSpy).toHaveBeenCalledTimes(1);
        expect(schedulerSession.punchRecordingActive).toBe(true);

        heldFlush.prime();
        pausePlayback();
        expect(transportStoreState.value?.isPlaying).toBe(false);

        // Play lands while the old flush is still pending: a new generation
        // takes the scheduler, exactly as startPlayback does.
        transportStoreState.value = { ...transportStoreState.value!, isPlaying: true };
        startPlayheadScheduler();
        expect(schedulerSession.generation).toBe(pausedGeneration + 1);

        heldFlush.release?.();
        await settle();

        // The old continuation saw the successor and skipped its teardown; the
        // successor still ticks inside the punch region and must open its own.
        await runTick(schedulerWorker());
        expect(startAudioRecordingSpy).toHaveBeenCalledTimes(2);
        expect(schedulerSession.punchRecordingActive).toBe(true);
    });

    it('never lets the late flush continuation clear a punch the successor already opened', async () => {
        startPlayheadScheduler();
        await runIntoPunchRegion();
        expect(startAudioRecordingSpy).toHaveBeenCalledTimes(1);

        heldFlush.prime();
        pausePlayback();
        transportStoreState.value = { ...transportStoreState.value!, isPlaying: true };
        startPlayheadScheduler();

        // The successor punches in before the old flush resolves.
        await runTick(schedulerWorker());
        expect(startAudioRecordingSpy).toHaveBeenCalledTimes(2);
        expect(schedulerSession.punchRecordingActive).toBe(true);

        heldFlush.release?.();
        await settle();

        // The late continuation returned early; the successor's punch stands.
        expect(schedulerSession.punchRecordingActive).toBe(true);
        expect(transportStoreState.value?.isRecording).toBe(true);
    });

    it('retires the punch through the ordinary pause teardown when no Play interrupts the flush', async () => {
        startPlayheadScheduler();
        await runIntoPunchRegion();
        expect(schedulerSession.punchRecordingActive).toBe(true);

        heldFlush.prime();
        pausePlayback();
        heldFlush.release?.();
        await settle();

        // No successor: the pause continuation tore the scheduler down and
        // retired the punch with it.
        expect(schedulerSession.punchRecordingActive).toBe(false);

        // A later resume punches in again from inside the region.
        transportStoreState.value = { ...transportStoreState.value!, isPlaying: true, isRecording: false };
        startPlayheadScheduler();
        await runTick(schedulerWorker());
        expect(startAudioRecordingSpy).toHaveBeenCalledTimes(2);
    });
});
