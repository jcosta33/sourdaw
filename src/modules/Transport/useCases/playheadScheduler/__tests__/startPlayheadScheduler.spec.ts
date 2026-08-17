import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { applyAutomation } from '../../scheduling/applyAutomation/applyAutomation';
import { applyVcaGains } from '../../scheduling/applyAutomation/applyVcaGains';
import { resetMetronomeBeat } from '../../scheduling/resetMetronomeBeat';
import { scheduleAudioClips } from '../../scheduling/scheduleAudioClips';
import { scheduleMetronome } from '../../scheduling/scheduleMetronome';
import { scheduleMidiNotes } from '../../scheduling/scheduleMidiNotes';
import { panicYeastRuntime } from '../../transportControls/panicYeastRuntime';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { schedulerTimingDiagnostics } from '../schedulerTimingDiagnostics';
import { startPlayheadScheduler } from '../startPlayheadScheduler';

// Mutable store holders so each test can seed the transport + tempo-map
// without fighting vi.mock hoisting.
const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } | null } = { value: { changes: [] } };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const takeLaneStoreState: { value: { lanes: unknown[] } | null } = { value: { lanes: [] } };
// currentTime holder so tests can advance the clock BETWEEN init and a tick
// without vi.mocked() overrides that don't reach the module's bound import.
const ctxTime = { now: 0 };
// Round-trip latency the punch path reads off the context to size the recorded
// clip's media lead-in. Zero by default so existing tests see no offset.
const ctxLatency = { base: 0, output: 0 };
// AudioEngine mock holder. The vi.mock factory wraps each export in a thin
// forwarder to these vi.fn instances; both the module-under-test and the test
// assertions read/write the SAME spies (the factory's arrow wrappers are stable
// identities, but the fns behind them are the ones we clear/inspect). This
// sidesteps the Vite/vi.mock binding split where vi.mocked(importedFn) reports
// a different spy than the one the module's destructured import calls.
const audioEngineMocks = {
    getAudioContext: vi.fn(() => ({
        get currentTime() {
            return ctxTime.now;
        },
        get baseLatency() {
            return ctxLatency.base;
        },
        get outputLatency() {
            return ctxLatency.output;
        },
    })),
    getCompensationDelay: vi.fn(() => 0),
    audioEngine: { setTransportInfo: vi.fn() },
    stopAllScheduled: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
};

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: {
        get value() {
            return takeLaneStoreState.value;
        },
    },
}));
vi.mock('../../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return transportStoreState.value;
        },
        // The real updateTransportState (../../repositories/transport/) merges a
        // patch through transportStore.set; wire it to the holder so the live
        // integration path runs instead of a mock that vi.mock fails to bind here.
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
// Arrangement + Automation mock holders (same binding-split workaround).
const arrangementMocks = {
    startRecording: vi.fn(() => [] as { trackId: string; id: string }[]),
    stopRecording: vi.fn(),
    addTakeLane: vi.fn(),
    addTake: vi.fn(),
    updateClip: vi.fn(),
    updateTransportState: vi.fn(),
};
const automationMocks = {
    startAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
};
const evaluateFollowActionsMock = vi.fn<
    (tracks: unknown[], from: number, to: number) => { jumpToPosition: number | null; shouldStop: boolean }
>(() => ({ jumpToPosition: null, shouldStop: false }));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    startRecording: (...args: unknown[]) => (arrangementMocks.startRecording as (...a: unknown[]) => unknown)(...args),
    stopRecording: (...args: unknown[]) => (arrangementMocks.stopRecording as (...a: unknown[]) => unknown)(...args),
    addTakeLane: (...args: unknown[]) => (arrangementMocks.addTakeLane as (...a: unknown[]) => unknown)(...args),
    addTake: (...args: unknown[]) => (arrangementMocks.addTake as (...a: unknown[]) => unknown)(...args),
    updateClip: (...args: unknown[]) => (arrangementMocks.updateClip as (...a: unknown[]) => unknown)(...args),
    updateTransportState: (...args: unknown[]) =>
        (arrangementMocks.updateTransportState as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: () => audioEngineMocks.getAudioContext(),
    getCompensationDelay: (...args: unknown[]) =>
        (audioEngineMocks.getCompensationDelay as (...a: unknown[]) => unknown)(...args),
    audioEngine: {
        setTransportInfo: (...args: unknown[]) =>
            (audioEngineMocks.audioEngine.setTransportInfo as (...a: unknown[]) => unknown)(...args),
    },
    stopAllScheduled: (...args: unknown[]) =>
        (audioEngineMocks.stopAllScheduled as (...a: unknown[]) => unknown)(...args),
    startAudioRecording: (...args: unknown[]) =>
        (audioEngineMocks.startAudioRecording as (...a: unknown[]) => unknown)(...args),
    stopAudioRecording: (...args: unknown[]) =>
        (audioEngineMocks.stopAudioRecording as (...a: unknown[]) => unknown)(...args),
    cacheAudioBuffer: (...args: unknown[]) =>
        (audioEngineMocks.cacheAudioBuffer as (...a: unknown[]) => unknown)(...args),
    refreshSidechainAlignment: (...args: unknown[]) =>
        (audioEngineMocks.refreshSidechainAlignment as (...a: unknown[]) => unknown)(...args),
    scheduleAdjustmentLayers: (...args: unknown[]) =>
        (audioEngineMocks.scheduleAdjustmentLayers as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: (...args: unknown[]) =>
        (automationMocks.startAutomationRecording as (...a: unknown[]) => unknown)(...args),
    applyModulation: (...args: unknown[]) => (automationMocks.applyModulation as (...a: unknown[]) => unknown)(...args),
    applyModulationToEngine: (...args: unknown[]) =>
        (automationMocks.applyModulationToEngine as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: (...args: unknown[]) => (evaluateFollowActionsMock as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../scheduling/resetMetronomeBeat', () => ({ resetMetronomeBeat: vi.fn() }));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
vi.mock('../../scheduling/scheduleMetronome', () => ({ scheduleMetronome: vi.fn() }));
vi.mock('../../scheduling/scheduleMidiNotes', () => ({ scheduleMidiNotes: vi.fn(() => Promise.resolve()) }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../repositories/transport/updateTransportState', () => ({ updateTransportState: vi.fn() }));

function playingState(overrides: Partial<typeof defaultTransportState> = {}): typeof defaultTransportState {
    return { ...defaultTransportState, isPlaying: true, playheadPosition: 0, ...overrides };
}

type SchedulerWorkerHarness = {
    onmessage: ((event: { data: unknown }) => void) | null;
};

let schedulerTickSequence = 0;

function emitSchedulerTick(worker: SchedulerWorkerHarness, generation = schedulerSession.generation): void {
    schedulerTickSequence++;
    const receivedAtMs = performance.timeOrigin + performance.now();
    worker.onmessage?.({
        data: {
            type: 'tick',
            generation,
            sequence: schedulerTickSequence,
            scheduledAtMs: receivedAtMs - 2,
            sentAtMs: receivedAtMs - 1,
        },
    });
}

describe('startPlayheadScheduler', () => {
    beforeEach(() => {
        // Clear the relative-path mocks (resolved to shared spies) and reset
        // every holder spy individually — vi.clearAllMocks() does not reach the
        // holder-held fns behind the forwarder wrappers.
        vi.clearAllMocks();
        for (const fn of [
            ...Object.values(audioEngineMocks),
            ...Object.values(arrangementMocks),
            ...Object.values(automationMocks),
            evaluateFollowActionsMock,
        ]) {
            if (typeof fn === 'function' && 'mockClear' in fn) {
                (fn as ReturnType<typeof vi.fn>).mockClear();
                (fn as ReturnType<typeof vi.fn>).mockReset();
            }
        }
        for (const fn of Object.values(audioEngineMocks.audioEngine)) {
            if (typeof fn === 'function' && 'mockClear' in fn) {
                (fn as ReturnType<typeof vi.fn>).mockClear();
            }
        }
        // Restore default implementations cleared by mockReset.
        audioEngineMocks.getAudioContext.mockImplementation(() => ({
            get currentTime() {
                return ctxTime.now;
            },
            get baseLatency() {
                return ctxLatency.base;
            },
            get outputLatency() {
                return ctxLatency.output;
            },
        }));
        audioEngineMocks.getCompensationDelay.mockImplementation(() => 0);
        arrangementMocks.startRecording.mockImplementation(() => []);
        evaluateFollowActionsMock.mockImplementation(() => ({ jumpToPosition: null, shouldStop: false }));
        transportStoreState.value = playingState();
        tempoMapStoreState.value = { changes: [] };
        trackStoreState.value = { tracks: [] };
        takeLaneStoreState.value = { lanes: [] };
        ctxTime.now = 0;
        ctxLatency.base = 0;
        ctxLatency.output = 0;
        schedulerTickSequence = 0;
        disposePlayheadScheduler();
        // disposePlayheadScheduler nulls the worker; startPlayheadScheduler will
        // recreate one. Stub the global Worker to a plain object with postMessage
        // so the new Worker(...) call returns something the scheduler can wire.
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

    it('bails immediately when transportStore is null', () => {
        transportStoreState.value = null;

        startPlayheadScheduler();

        expect(automationMocks.startAutomationRecording).not.toHaveBeenCalled();
    });

    it('initialises the scheduler session from the transport position and starts the worker', () => {
        transportStoreState.value = playingState({ playheadPosition: 8, scheduleGrainMs: 25 });

        startPlayheadScheduler();

        // generation advanced, position seeded, metronome reset to the start.
        expect(schedulerSession.accumulatedPosition).toBe(8);
        expect(playheadPositionRef.current).toBe(8);
        // lastScheduledBeat sits just behind the playhead so the first tick
        // schedules the current beat instead of re-emitting behind it.
        expect(schedulerSession.lastScheduledBeat).toBeCloseTo(8 - 0.0001, 6);
        expect(vi.mocked(resetMetronomeBeat)).toHaveBeenCalledWith(8);
        const worker = schedulerSession.worker as unknown as { postMessage: ReturnType<typeof vi.fn> };
        expect(worker.postMessage).toHaveBeenCalledWith({
            type: 'start',
            interval: 25,
            generation: schedulerSession.generation,
        });
    });

    it('runs a tick that schedules metronome, midi, audio, and automation in order', async () => {
        transportStoreState.value = playingState({ playheadPosition: 0 });
        ctxTime.now = 0.1;

        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(vi.mocked(scheduleMetronome)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleMidiNotes)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleAudioClips)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(applyAutomation)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(applyVcaGains)).toHaveBeenCalledTimes(1);
        expect(audioEngineMocks.refreshSidechainAlignment).toHaveBeenCalledTimes(1);
        expect(audioEngineMocks.scheduleAdjustmentLayers).toHaveBeenCalledTimes(1);
        expect(schedulerTimingDiagnostics.snapshot().messagesReceived).toBe(1);
        expect(schedulerTimingDiagnostics.snapshot().ticksSettled).toBe(1);
    });

    it('skips a tick when a prior tick is still in flight', async () => {
        transportStoreState.value = playingState();
        // scheduleMidiNotes resolves on the next microtask; the second tick
        // message arriving before it resolves must no-op via tickInFlight.
        const midiScheduling: { resolve(): void } = { resolve() {} };
        vi.mocked(scheduleMidiNotes).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    midiScheduling.resolve = resolve;
                })
        );
        ctxTime.now = 0.1;

        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        // Second tick before the first resolves: tickInFlight guard skips it.
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(vi.mocked(scheduleMidiNotes)).toHaveBeenCalledTimes(1);
        expect(schedulerTimingDiagnostics.snapshot().messagesReceived).toBe(2);
        expect(schedulerTimingDiagnostics.snapshot().ticksSkippedInFlight).toBe(1);
        midiScheduling.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(schedulerTimingDiagnostics.snapshot().ticksSettled).toBe(1);
    });

    // `onmessage` filters a stale generation before it ever calls `tick`, so the
    // guard inside `tick` only earns its place if the session can be retired
    // between the two. `recordTickMessage` runs in exactly that gap; driving the
    // retirement from there reaches the retired `tick` body directly.
    //
    // Without the guard, that tick claims `tickInFlight`, `runTick` bails on the
    // generation, and the `finally` refuses to release a flag owned by another
    // generation — leaving it stuck true, so the live session skips every tick
    // at the in-flight guard and the playhead freezes while still reporting
    // playback.
    it('does not let a tick retired between the message filter and the tick body claim the in-flight flag', async () => {
        transportStoreState.value = playingState({ playheadPosition: 0 });
        startPlayheadScheduler();
        const staleWorker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        const recordTickMessage = vi
            .spyOn(schedulerTimingDiagnostics, 'recordTickMessage')
            .mockImplementationOnce(() => {
                schedulerSession.generation += 1;
            });

        emitSchedulerTick(staleWorker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        recordTickMessage.mockRestore();

        expect(schedulerSession.tickInFlight).toBe(false);

        // The next session must still run. 0.1s at 120bpm advances it by 0.2
        // beats — it only moves if the retired tick left the flag alone.
        startPlayheadScheduler();
        const activeWorker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        ctxTime.now = 0.1;
        emitSchedulerTick(activeWorker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(vi.mocked(scheduleMetronome)).toHaveBeenCalledTimes(1);
        expect(schedulerSession.accumulatedPosition).toBeCloseTo(0.2, 5);
        expect(schedulerTimingDiagnostics.snapshot().ticksSkippedInFlight).toBe(0);
    });

    it('halts the tick when transport is no longer current (not playing)', async () => {
        transportStoreState.value = playingState();

        startPlayheadScheduler();
        // Flip to not-playing AFTER setup so the cancellation guard fires in runTick.
        transportStoreState.value = playingState({ isPlaying: false });
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(vi.mocked(scheduleMetronome)).not.toHaveBeenCalled();
    });

    it('clamps a suspended-context clock leap so the playhead never races past scheduled beats', async () => {
        transportStoreState.value = playingState({ playheadPosition: 0 });
        // Init reads currentTime 0 → lastTickTime seeded at 0.
        startPlayheadScheduler();
        // The first tick sees a huge currentTime leap (10s), which an unclamped
        // delta would turn into ~20 beats of skipped advance.
        ctxTime.now = 10;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // deltaSec clamped to MAX_DELTA_SECONDS (0.1); at 120bpm (2 bps) that is
        // 0.2 beats of advance — not the 20 beats an unclamped 10s leap implies.
        expect(schedulerSession.accumulatedPosition).toBeLessThan(1);
        expect(schedulerSession.accumulatedPosition).toBeCloseTo(0.2, 5);
    });

    it('clears the dedup Sets and stops active sources when the tempo map changes mid-playback', async () => {
        transportStoreState.value = playingState();
        ctxTime.now = 0.1;

        startPlayheadScheduler();
        // Mutate the tempo-map identity so liveChanges !== lastTempoMapChanges.
        tempoMapStoreState.value = { changes: [{ id: 't1', beat: 0, tempo: 140, curve: 'instant' }] };
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(audioEngineMocks.stopAllScheduled).toHaveBeenCalled();
        expect(schedulerSession.scheduledAudioClips.size).toBe(0);
        // lastTempoMapChanges now matches the new identity.
        expect(schedulerSession.lastTempoMapChanges).toBe(tempoMapStoreState.value?.changes);
    });

    it('wraps the playhead at loopEnd and clears scheduling state for the next pass', async () => {
        transportStoreState.value = playingState({
            playheadPosition: 3.9,
            isLooping: true,
            loopStart: 0,
            loopEnd: 4,
        });
        // Init reads currentTime 0 → lastTickTime seeded at 0.
        startPlayheadScheduler();
        // A 0.2s clock delta is clamped to MAX_DELTA_SECONDS (0.1) → 0.2 beats
        // of advance from 3.9 → 4.1, crossing loopEnd 4 and wrapping to 0.1.
        ctxTime.now = 0.2;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Wrapped back into the loop region: 0 + (4.1 % 4) = 0.1.
        expect(schedulerSession.accumulatedPosition).toBeCloseTo(0.1, 5);
        expect(vi.mocked(panicYeastRuntime)).toHaveBeenCalledTimes(1);
        expect(audioEngineMocks.stopAllScheduled).toHaveBeenCalled();
        expect(vi.mocked(resetMetronomeBeat)).toHaveBeenCalledWith(expect.closeTo(0.1, 5));
    });

    it('opens a take lane and adds a take for each armed track on a loop wrap while recording', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        takeLaneStoreState.value = null;
        transportStoreState.value = playingState({
            playheadPosition: 3.9,
            isLooping: true,
            loopStart: 0,
            loopEnd: 4,
            isRecording: true,
        });
        startPlayheadScheduler();
        ctxTime.now = 0.2;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(arrangementMocks.addTakeLane).toHaveBeenCalledWith('rec-1');
        expect(arrangementMocks.addTake).toHaveBeenCalledWith(
            'rec-1',
            expect.any(String),
            expect.stringContaining('Take'),
            0,
            4
        );
    });

    it('skips the take-lane open when the armed track already has a lane on a loop wrap', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        takeLaneStoreState.value = { lanes: [{ trackId: 'rec-1', takes: [] }] };
        transportStoreState.value = playingState({
            playheadPosition: 3.9,
            isLooping: true,
            loopStart: 0,
            loopEnd: 4,
            isRecording: true,
        });
        ctxTime.now = 0.2;

        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Lane already exists → no new lane created, but a take is still added.
        expect(arrangementMocks.addTakeLane).not.toHaveBeenCalled();
    });

    it('stops playback when a follow action requests a stop', async () => {
        const onStop = vi.fn();
        schedulerSession.onStopRequested = onStop;
        transportStoreState.value = playingState();
        evaluateFollowActionsMock.mockReturnValueOnce({ jumpToPosition: null, shouldStop: true });
        ctxTime.now = 0.1;

        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(onStop).toHaveBeenCalledTimes(1);
        // Nothing past the stop is scheduled.
        expect(vi.mocked(scheduleMetronome)).not.toHaveBeenCalled();
    });

    it('jumps to the follow-action position and panics the yeast runtime on a discontinuity', async () => {
        transportStoreState.value = playingState();
        evaluateFollowActionsMock.mockReturnValueOnce({ jumpToPosition: 16, shouldStop: false });
        ctxTime.now = 0.1;

        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(schedulerSession.accumulatedPosition).toBe(16);
        expect(vi.mocked(panicYeastRuntime)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(resetMetronomeBeat)).toHaveBeenCalledWith(16);
    });

    it('aborts the tick after a rack discontinuity when the scheduler generation is stale', async () => {
        transportStoreState.value = playingState();
        evaluateFollowActionsMock.mockReturnValueOnce({ jumpToPosition: 16, shouldStop: false });
        // panicYeastRuntime flips the generation stale; the post-await isCurrent
        // guard must abort before scheduling.
        vi.mocked(panicYeastRuntime).mockImplementationOnce(async () => {
            schedulerSession.generation += 1;
        });
        ctxTime.now = 0.1;

        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(vi.mocked(scheduleMetronome)).not.toHaveBeenCalled();
    });

    it('starts punch-in recording when the playhead crosses punchInBeat with armed audio tracks', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            punchInEnabled: true,
            punchInBeat: 0,
            punchOutBeat: 8,
        });
        arrangementMocks.startRecording.mockReturnValueOnce([{ trackId: 'rec-1', id: 'clip-rec-1' }]);
        startPlayheadScheduler();
        // Advance the playhead past punchInBeat 0 (0.1s @ 120bpm = 0.2 beats).
        ctxTime.now = 0.1;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(arrangementMocks.startRecording).toHaveBeenCalledTimes(1);
        expect(audioEngineMocks.startAudioRecording).toHaveBeenCalledTimes(1);
        expect(schedulerSession.punchRecordingActive).toBe(true);
    });

    // The crossing is only detected once the playhead is at or past punchInBeat,
    // so the tick that opens the recording already sits inside the region. The
    // clip belongs at the punch point, not at the tick — and least of all at the
    // transport store's playhead, which has not moved since playback started.
    it('anchors the punched clip at punchInBeat when the tick lands past it', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            playheadPosition: 15.9,
            punchInEnabled: true,
            punchInBeat: 16,
            punchOutBeat: 24,
        });
        startPlayheadScheduler();
        // 0.1s at 120bpm = 0.2 beats: 15.9 → 16.1, one tick past punchInBeat 16.
        ctxTime.now = 0.1;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(schedulerSession.accumulatedPosition).toBeGreaterThan(16);
        expect(arrangementMocks.startRecording).toHaveBeenCalledWith(16);
    });

    // Rolling in from inside the region is the other half of that anchor. Here
    // nothing was captured between punchInBeat and the entry beat, so anchoring
    // at punchInBeat would displace the take backwards by the whole distance
    // already covered and leave the tail of the clip silent.
    it('anchors the punched clip at the entry beat when playback starts inside the region', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            playheadPosition: 20,
            punchInEnabled: true,
            punchInBeat: 16,
            punchOutBeat: 24,
        });
        startPlayheadScheduler();
        // The transport is already 4 beats inside [16, 24); the first tick opens
        // the recording at 20, where capture actually begins.
        ctxTime.now = 0.1;
        const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(arrangementMocks.startRecording).toHaveBeenCalledTimes(1);
        expect(arrangementMocks.startRecording).toHaveBeenCalledWith(20);
        expect(arrangementMocks.startRecording).not.toHaveBeenCalledWith(16);
    });

    // Past the region there is nothing left to punch. Without an upper bound the
    // same tick satisfies punch-in and punch-out, stamping a full-width clip and
    // take across the region that captured nothing.
    it('does not punch in when playback starts past the punch region', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            playheadPosition: 30,
            punchInEnabled: true,
            punchInBeat: 16,
            punchOutBeat: 24,
        });
        startPlayheadScheduler();
        ctxTime.now = 0.1;
        const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(arrangementMocks.startRecording).not.toHaveBeenCalled();
        expect(audioEngineMocks.startAudioRecording).not.toHaveBeenCalled();
        expect(arrangementMocks.stopRecording).not.toHaveBeenCalled();
        expect(schedulerSession.punchRecordingActive).toBe(false);
    });

    // The punched clip is anchored on the punch point, so a note played on the
    // punch downbeat has no room to move earlier unless the clip carries a media
    // lead-in. midiOffsetBeats supplies it: the media origin sits at
    // `startBeat - midiOffsetBeats`, leaving the clip start on the punch point.
    it('gives a punched MIDI clip a media lead-in the size of the round-trip latency', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'midi' }] };
        transportStoreState.value = playingState({
            playheadPosition: 15.9,
            punchInEnabled: true,
            punchInBeat: 16,
            punchOutBeat: 24,
        });
        // 0.005 + 0.015 context + 0.010 track = 0.030s; at 120bpm that is 0.06
        // beats of compensation the recorded notes have to be able to express.
        ctxLatency.base = 0.005;
        ctxLatency.output = 0.015;
        audioEngineMocks.getCompensationDelay.mockImplementation(() => 0.01);
        arrangementMocks.startRecording.mockReturnValueOnce([{ trackId: 'rec-1', id: 'clip-rec-1' }]);
        startPlayheadScheduler();
        ctxTime.now = 0.1;
        const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(arrangementMocks.startRecording).toHaveBeenCalledWith(16);
        expect(arrangementMocks.updateClip).toHaveBeenCalledWith('clip-rec-1', expect.any(Function));
        const [, updater] = arrangementMocks.updateClip.mock.calls.at(-1) as unknown as [
            string,
            (clip: Record<string, unknown>) => Record<string, unknown>,
        ];
        const updated = updater({ id: 'clip-rec-1', startBeat: 16, endBeat: 24 });
        expect(updated.midiOffsetBeats).toBeCloseTo(0.06, 6);
        // The clip still begins on the punch point; only its media origin moved.
        expect(updated.startBeat).toBe(16);
        // Media origin = startBeat - midiOffsetBeats, so a note struck inside the
        // compensation window resolves to a positive clip-relative beat instead
        // of clamping to 0 the way an origin exactly on the anchor forces.
        const mediaOrigin = 16 - (updated.midiOffsetBeats as number);
        expect(Math.max(0, 16.03 - 0.06 - mediaOrigin)).toBeCloseTo(0.03, 6);
    });

    it('leaves a punched audio clip without a MIDI lead-in', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            playheadPosition: 15.9,
            punchInEnabled: true,
            punchInBeat: 16,
            punchOutBeat: 24,
        });
        ctxLatency.base = 0.005;
        ctxLatency.output = 0.015;
        arrangementMocks.startRecording.mockReturnValueOnce([{ trackId: 'rec-1', id: 'clip-rec-1' }]);
        startPlayheadScheduler();
        ctxTime.now = 0.1;
        const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(arrangementMocks.updateClip).not.toHaveBeenCalled();
    });

    it('routes the punch-in recording buffer through cacheAudioBuffer + updateClip', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            punchInEnabled: true,
            punchInBeat: 0,
            punchOutBeat: 8,
        });
        const recClip = { trackId: 'rec-1', id: 'clip-rec-1' };
        arrangementMocks.startRecording.mockReturnValueOnce([recClip]);
        let capturedOnBuffer: ((buffer: unknown) => void) | null = null;
        audioEngineMocks.startAudioRecording.mockImplementationOnce(((
            _trackId: string,
            onBuffer: (buffer: unknown) => void
        ) => {
            capturedOnBuffer = onBuffer;
            return Promise.resolve();
        }) as never);
        startPlayheadScheduler();
        ctxTime.now = 0.1;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Drive the recorded-buffer callback the engine invokes.
        expect(capturedOnBuffer).not.toBeNull();
        capturedOnBuffer!({ duration: 1 });
        expect(audioEngineMocks.cacheAudioBuffer).toHaveBeenCalledWith({
            buffer: { duration: 1 },
            bufferId: expect.any(String),
        });
        expect(arrangementMocks.updateClip).toHaveBeenCalledWith('clip-rec-1', expect.any(Function));
    });

    it('stops punch-out recording and clears the flag once the playhead crosses punchOutBeat', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            playheadPosition: 7.9,
            punchInEnabled: true,
            punchInBeat: 0,
            punchOutBeat: 8,
        });
        schedulerSession.punchRecordingActive = true;
        startPlayheadScheduler();
        // 0.2s delta at 120bpm = 0.4 beats → from 7.9 to 8.3, crossing punchOut 8.
        ctxTime.now = 0.2;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(audioEngineMocks.stopAudioRecording).toHaveBeenCalledTimes(1);
        expect(arrangementMocks.stopRecording).toHaveBeenCalledTimes(1);
        // The tick overshoots to 8.3; the take ends at the punch-out point.
        expect(schedulerSession.accumulatedPosition).toBeGreaterThan(8);
        expect(arrangementMocks.stopRecording).toHaveBeenCalledWith(8);
        expect(schedulerSession.punchRecordingActive).toBe(false);
    });

    it('ignores non-tick and malformed tick worker messages', async () => {
        transportStoreState.value = playingState();
        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        const receivedAtMs = performance.timeOrigin + performance.now();
        worker.onmessage?.({ data: { type: 'other' } });
        worker.onmessage?.({
            data: { type: 'tick', generation: schedulerSession.generation, scheduledAtMs: 1, sentAtMs: 2 },
        });
        worker.onmessage?.({
            data: { type: 'tick', generation: schedulerSession.generation, sequence: 1, scheduledAtMs: 2, sentAtMs: 1 },
        });
        worker.onmessage?.({
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence: Number.MAX_SAFE_INTEGER + 1,
                scheduledAtMs: receivedAtMs - 2,
                sentAtMs: receivedAtMs - 1,
            },
        });
        worker.onmessage?.({
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence: 1,
                scheduledAtMs: receivedAtMs + 4,
                sentAtMs: receivedAtMs + 5,
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(schedulerTimingDiagnostics.snapshot().messagesReceived).toBe(0);
        expect(vi.mocked(scheduleMetronome)).not.toHaveBeenCalled();
    });

    it('ignores a queued tick from a retired scheduler generation', async () => {
        transportStoreState.value = playingState();
        startPlayheadScheduler();
        const retiredWorker = schedulerSession.worker as unknown as SchedulerWorkerHarness;

        disposePlayheadScheduler();
        startPlayheadScheduler();
        const activeWorker = schedulerSession.worker as unknown as SchedulerWorkerHarness;

        emitSchedulerTick(retiredWorker);
        expect(schedulerTimingDiagnostics.snapshot().messagesReceived).toBe(0);

        emitSchedulerTick(activeWorker);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(schedulerTimingDiagnostics.snapshot().messagesReceived).toBe(1);
        expect(vi.mocked(scheduleMetronome)).toHaveBeenCalledTimes(1);
    });

    it('rebinds a reused worker and clears a retired in-flight tick on restart', async () => {
        transportStoreState.value = playingState();
        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
        const retiredHandler = worker.onmessage;
        const retiredGeneration = schedulerSession.generation;
        schedulerSession.tickInFlight = true;

        startPlayheadScheduler();

        expect(schedulerSession.worker).toBe(worker);
        expect(worker.onmessage).not.toBe(retiredHandler);
        expect(schedulerSession.tickInFlight).toBe(false);
        emitSchedulerTick(worker, retiredGeneration);
        expect(schedulerTimingDiagnostics.snapshot().messagesReceived).toBe(0);
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(schedulerTimingDiagnostics.snapshot().messagesReceived).toBe(1);
        expect(vi.mocked(scheduleMetronome)).toHaveBeenCalledTimes(1);
    });

    it('aborts after scheduleMidiNotes when the scheduler generation goes stale', async () => {
        transportStoreState.value = playingState();
        // scheduleMidiNotes flips the generation stale; the post-await isCurrent
        // guard must abort before scheduleAudioClips.
        vi.mocked(scheduleMidiNotes).mockImplementationOnce(async () => {
            schedulerSession.generation += 1;
        });
        ctxTime.now = 0.1;

        startPlayheadScheduler();
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(vi.mocked(scheduleMidiNotes)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleAudioClips)).not.toHaveBeenCalled();
    });

    it('aborts after punch-out when the scheduler generation goes stale', async () => {
        trackStoreState.value = { tracks: [{ id: 'rec-1', armed: true, kind: 'audio' }] };
        transportStoreState.value = playingState({
            playheadPosition: 7.9,
            punchInEnabled: true,
            punchInBeat: 0,
            punchOutBeat: 8,
        });
        schedulerSession.punchRecordingActive = true;
        // stopAudioRecording flips generation stale; the post-await isCurrent
        // guard must abort before scheduling anything.
        audioEngineMocks.stopAudioRecording.mockImplementationOnce(async () => {
            schedulerSession.generation += 1;
        });
        startPlayheadScheduler();
        ctxTime.now = 0.2;
        const worker = schedulerSession.worker as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
        };
        emitSchedulerTick(worker);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(vi.mocked(scheduleMetronome)).not.toHaveBeenCalled();
    });
});
