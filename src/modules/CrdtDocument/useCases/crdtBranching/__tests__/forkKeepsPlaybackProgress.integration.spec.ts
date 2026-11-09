import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { playheadClockRef, playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import { getSchedulerTimingDiagnostics, setPlayback, stopPlayback } from '#/modules/Transport/useCases';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore } from '../../../stores/branchStore';
import { captureProjectRootIdentity } from '../../captureProjectRootIdentity';
import { mutateCrdtDoc } from '../../mutateCrdtDoc';
import { projectCrdtToStores } from '../../projection/projectProjection';
import { setupProjectionBridge } from '../../projection/setupProjectionBridge';
import { registerCrdtStorageRuntime } from '../../registerCrdtStorageRuntime';
import { runCrdtPersistenceOperation } from '../../runCrdtPersistenceOperation';
import { forkProjectBranch } from '../forkProjectBranch';

// Fork, projection, public Play and the scheduler stay real. A metronome beat
// beyond the initial buffer horizon also observes work after clock publication.
const hardware = vi.hoisted(() => ({
    now: 0,
    scheduleClick: vi.fn<(time: number, accent: boolean, volume: number) => void>(),
}));

const audioContextStub = {
    sampleRate: 48_000,
    get currentTime() {
        return hardware.now;
    },
    createGain: () => ({
        gain: {
            value: 1,
            cancelScheduledValues: vi.fn(),
            cancelAndHoldAtTime: vi.fn(),
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
    }),
};

vi.mock('../../compactProject', () => ({ compactProject: vi.fn(() => Promise.resolve()) }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    audioEngine: {
        beginAudioPreviewIntent: () => ({
            signal: new AbortController().signal,
            isCurrent: () => true,
            release: vi.fn(),
        }),
        setTransportInfo: vi.fn(),
    },
    getAudioContext: () => audioContextStub,
    getCurrentTime: () => hardware.now,
    getCompensationDelay: () => 0,
    scheduleClick: hardware.scheduleClick,
    resumeEngine: () => Promise.resolve(),
    nativeLiveGraphSessionOffered: () => false,
    readNativeEnginePlayheadSeconds: () => null,
    createNativeRecordingCaptureClock: () => ({
        admission: null,
        last: null,
        read: () => ({ carrier: 'browser' as const }),
    }),
    stopNativeLiveGraphSession: () => Promise.resolve({ outcome: 'declined', reason: 'browser fixture' }),
    stopAudioRecording: () => Promise.resolve(),
    stopAllScheduled: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
}));

type WorkerStart = { type: string; generation?: number };
class SchedulerWorkerHardware {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    generation = 0;
    sequence = 0;
    terminated = false;

    constructor() {
        workers.push(this);
    }

    postMessage(message: WorkerStart): void {
        if (message.type === 'start') {
            this.generation = message.generation ?? 0;
        }
    }

    terminate(): void {
        this.terminated = true;
    }

    tick(): void {
        expect(this.terminated).toBe(false);
        expect(this.onmessage).toBeTypeOf('function');
        const receivedAtMs = performance.timeOrigin + performance.now();
        this.onmessage?.({
            data: {
                type: 'tick',
                generation: this.generation,
                sequence: ++this.sequence,
                scheduledAtMs: receivedAtMs - 2,
                sentAtMs: receivedAtMs - 1,
            },
        });
    }
}

const workers: SchedulerWorkerHardware[] = [];
let fixtureStartFrame = 0;

function fixtureSeconds(offsetFrames: number): number {
    return (fixtureStartFrame + offsetFrames) / 48_000;
}
let unsubscribeProjection: (() => void) | null = null;

registerDeviceEnginePorts();

async function tickAt(worker: SchedulerWorkerHardware, audioTime: number): Promise<void> {
    hardware.now = audioTime;
    const before = getSchedulerTimingDiagnostics();
    worker.tick();
    await vi.waitFor(
        () => {
            const after = getSchedulerTimingDiagnostics();
            expect(after.messagesReceived).toBe(before.messagesReceived + 1);
            expect(after.ticksSettled).toBe(before.ticksSettled + 1);
            expect(after.ticksSkippedInFlight).toBe(before.ticksSkippedInFlight);
            expect(logger.error).not.toHaveBeenCalled();
        },
        { interval: 1 }
    );
}

async function startSettledPlayback(): Promise<SchedulerWorkerHardware> {
    setPlayback(true);
    await vi.waitFor(
        () => {
            expect(logger.error).not.toHaveBeenCalled();
            expect(workers).toHaveLength(1);
            expect(workers[0]?.generation).toBeGreaterThan(0);
            expect(getSchedulerTimingDiagnostics().ticksSettled).toBeGreaterThan(0);
            expect(playheadClockRef.hold).toBeNull();
            expect(playheadClockRef.audioTimeSeconds).toBe(fixtureSeconds(4_800));
            expect(playheadClockRef.beat).toBe(0);
            expect(transportStore.value?.isPlaying).toBe(true);
        },
        { interval: 1 }
    );
    const worker = workers[0];
    if (!worker) {
        throw new Error('Expected the admitted scheduler worker');
    }
    await tickAt(worker, fixtureSeconds(6_000));
    expect(playheadClockRef.audioTimeSeconds).toBe(fixtureSeconds(6_000));
    expect(playheadClockRef.beat).toBeCloseTo(0.05, 12);
    return worker;
}

async function expectProgressAfterTransition(worker: SchedulerWorkerHardware): Promise<void> {
    await tickAt(worker, fixtureSeconds(7_200));
    // A received/settled tick alone still passes if cancellation skips runTick.
    expect(playheadClockRef.audioTimeSeconds).toBe(fixtureSeconds(7_200));
    expect(playheadClockRef.beat).toBeCloseTo(0.1, 12);
    expect(playheadPositionRef.current).toBeCloseTo(0.1, 12);
    expect(transportStore.value?.isPlaying).toBe(true);

    await tickAt(worker, fixtureSeconds(26_400));
    expect(playheadClockRef.audioTimeSeconds).toBe(fixtureSeconds(26_400));
    expect(playheadClockRef.beat).toBeCloseTo(0.9, 12);
    expect(playheadPositionRef.current).toBeCloseTo(0.9, 12);
    expect(transportStore.value?.isPlaying).toBe(true);
    // Beat 1 follows the 4800-frame roll lead by 24000 frames, beyond
    // the completed initial 350 ms buffer horizon.
    const beatOneClicks = hardware.scheduleClick.mock.calls.filter(
        ([time]) => Math.round(time * 48_000) === fixtureStartFrame + 28_800
    );
    expect(
        beatOneClicks,
        JSON.stringify({ clicks: hardware.scheduleClick.mock.calls, transport: transportStore.value })
    ).toHaveLength(1);
}

describe('fork keeps actual browser playback progressing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        // A real context never rewinds. Keep metronome time-dedup isolation
        // through its public clock/pruning route rather than private resets.
        fixtureStartFrame += 480_000;
        hardware.now = fixtureSeconds(0);
        workers.length = 0;
        vi.stubGlobal('Worker', SchedulerWorkerHardware);
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        automergeRepository.reset();
        automergeRepository.createProject('fork playback progression');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        resetAutomergeStorageProjections(DOC_PREFIX_ROOT);
        mutateCrdtDoc<{
            transport?: Pick<
                NonNullable<typeof transportStore.value>,
                'tempo' | 'isLooping' | 'loopStart' | 'loopEnd' | 'metronomeEnabled'
            >;
            tracks?: { tracks: []; selectedTrackId: null; ghostClips: [] };
            tempoMap?: { changes: [] };
            timeSignatureMap?: { changes: [] };
        }>({
            id: DOC_PREFIX_ROOT,
            changeFn: (draft) => {
                draft.transport = {
                    tempo: 120,
                    isLooping: true,
                    loopStart: 0,
                    loopEnd: 4,
                    metronomeEnabled: true,
                };
                draft.tracks = { tracks: [], selectedTrackId: null, ghostClips: [] };
                draft.tempoMap = { changes: [] };
                draft.timeSignatureMap = { changes: [] };
            },
        });
        projectCrdtToStores({ resetProjections: true });
        flushAutomergeStorageWrites();
        unsubscribeProjection = setupProjectionBridge();
        branchStore.set({
            branches: [
                {
                    branchId: 'main',
                    name: 'Main',
                    rootDocId: DOC_PREFIX_ROOT,
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'main',
        });
    });

    afterEach(async () => {
        await stopPlayback();
        expect(transportStore.value?.isPlaying).toBe(false);
        expect(workers.every((worker) => worker.terminated)).toBe(true);
        unsubscribeProjection?.();
        unsubscribeProjection = null;
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        automergeRepository.reset();
    });

    it('advances the published clock and later metronome without a fork', async () => {
        const worker = await startSettledPlayback();
        await expectProgressAfterTransition(worker);
    });

    it('advances the published clock and later metronome after a real successful fork', async () => {
        const worker = await startSettledPlayback();
        const rootBefore = captureProjectRootIdentity();
        const branchBefore = branchStore.value?.activeBranchId;
        const forkedBranchId = await forkProjectBranch('during playback');
        expect(captureProjectRootIdentity()).not.toBe(rootBefore);
        expect(forkedBranchId).not.toBe(branchBefore);
        expect(branchStore.value?.activeBranchId).toBe(forkedBranchId);
        expect(transportStore.value?.isPlaying).toBe(true);
        await expectProgressAfterTransition(worker);
    });

    it('advances the published clock and later metronome after a real fork rollback', async () => {
        const worker = await startSettledPlayback();
        const rootBefore = captureProjectRootIdentity();
        const branchBefore = branchStore.value?.activeBranchId;
        const held = Promise.withResolvers<void>();
        vi.mocked(runCrdtPersistenceOperation).mockImplementationOnce(() => held.promise);
        const forking = forkProjectBranch('rollback during playback');
        const forkOutcome = expect(forking).rejects.toThrow('quota exceeded');
        await vi.waitFor(() => expect(branchStore.value?.activeBranchId).not.toBe(branchBefore), { interval: 1 });
        const forkRoot = captureProjectRootIdentity();
        expect(forkRoot).not.toBe(rootBefore);
        held.reject(new Error('quota exceeded'));
        await forkOutcome;
        expect(captureProjectRootIdentity()).not.toBe(forkRoot);
        expect(branchStore.value?.activeBranchId).toBe(branchBefore);
        expect(transportStore.value?.isPlaying).toBe(true);
        await expectProgressAfterTransition(worker);
    });
});
