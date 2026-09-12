import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { DROPOUT_IDX, dropoutCounters } from '../../engine/dropoutCounter';
import { notRunningEngineRtDiagnostics } from '../../models/EngineRtDiagnostics';
import { getEngineRtDiagnostics } from '../../repositories/engineDiagnostics/getEngineRtDiagnostics';
import { LONG_TASK_OBSERVATION_UNSUPPORTED, readMainThreadLongTasks } from '../../services/mainThreadLongTaskLatch';
import { defaultEngineRtDiagnosticsState, engineRtDiagnosticsStore } from '../../stores/engineRtDiagnosticsStore';
import { collectAudioDeadlineEvidence } from '../collectAudioDeadlineEvidence';
import { getEngineState } from '../engineAccess/getEngineState';
import { refreshEngineRtDiagnostics } from '../engineAccess/refreshEngineRtDiagnostics';

import type { AudioEngineState } from '../../models/AudioEngineState';
import type { EngineRtDiagnostics } from '../../models/EngineRtDiagnostics';

vi.mock('../engineAccess/getEngineState', () => ({ getEngineState: vi.fn() }));
vi.mock('../../services/mainThreadLongTaskLatch', () => ({
    LONG_TASK_OBSERVATION_UNSUPPORTED: 'unsupported',
    readMainThreadLongTasks: vi.fn(),
}));
vi.mock('../../repositories/engineDiagnostics/getEngineRtDiagnostics', () => ({
    getEngineRtDiagnostics: vi.fn(),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const runningEngineState: AudioEngineState = {
    isReady: true,
    sampleRate: 48_000,
    state: 'running',
    masterGain: 1,
    currentTime: 4,
    baseLatency: 0.005,
    outputLatency: 0.01,
};

/**
 * Transports this file opened, so a case hands the shared counter back closed.
 * Tracked here rather than read back from `hasCoverage()`, which would make the
 * wind-down depend on the very behaviour these cases are pinning.
 */
let openTransports = 0;

/** Stand in for a transport whose worklet has taken the buffer and is counting. */
function startCountingTransport(): void {
    dropoutCounters.openCoverage();
    openTransports++;
}

/** Stand in for that transport tearing down. */
function stopCountingTransport(): void {
    dropoutCounters.closeCoverage();
    openTransports--;
}

/**
 * Drives the real counter rather than a stand-in, so a case that claims "no
 * coverage" is answered by the class the collector actually asks. Coverage and
 * count come from that one object, so a case states both together: the tally is
 * written straight into the shared buffer, as the worklet writes it.
 */
function wireDropoutCounter(coverage: boolean, detectedUnderrunBlocks = 0): void {
    const sab = dropoutCounters.getSab();
    if (sab === null) {
        throw new Error('this runtime has no SharedArrayBuffer for the dropout tally');
    }

    while (openTransports > 0) {
        stopCountingTransport();
    }
    dropoutCounters.reset();

    if (coverage) {
        startCountingTransport();
    }

    Atomics.store(new Int32Array(sab), DROPOUT_IDX.detectedUnderrunBlocks, detectedUnderrunBlocks);
}

const runningNativeDiagnostics: EngineRtDiagnostics = {
    running: true,
    schedulerEventBufferOverflows: 0,
    arpeggiatorActiveNoteExhaustions: 0,
    effectIdCollisions: 0,
    unsupportedEffectAdditions: 0,
    unmappedSetParamCalls: 0,
    captureConsumerRefusals: 0,
    captureBlocksDropped: 0,
    captureInputUnderruns: 0,
    inputLatencyFrames: 0,
    sampleRate: 48_000,
    outputBufferFrames: 256,
    outputPathFrames: 297,
    outputStreamFault: null,
    events: [],
};

describe('collectAudioDeadlineEvidence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        engineRtDiagnosticsStore.set(defaultEngineRtDiagnosticsState);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set(defaultTransportState);

        vi.mocked(getEngineState).mockReturnValue(runningEngineState);
        wireDropoutCounter(true);
        vi.mocked(readMainThreadLongTasks).mockReturnValue(LONG_TASK_OBSERVATION_UNSUPPORTED);
    });

    it('never reports a loopback figure, because nothing recaptures the signal this platform emits', () => {
        const evidence = collectAudioDeadlineEvidence();

        expect(evidence.loopbackDiscontinuities).toEqual({
            coverage: 'unavailable',
            reason: expect.stringContaining('loopback'),
        });
        expect('events' in evidence.loopbackDiscontinuities).toBe(false);
        expect(Object.keys(evidence.loopbackDiscontinuities).toSorted()).toEqual(['coverage', 'reason']);
    });

    it('carries no events field on any category it has no observer for', () => {
        wireDropoutCounter(false);

        const evidence = collectAudioDeadlineEvidence();

        const uncovered = [
            evidence.engineUnderruns,
            evidence.nativeStreamFaults,
            evidence.mainThreadLongTasks,
            evidence.loopbackDiscontinuities,
        ];

        for (const reading of uncovered) {
            expect(reading.coverage).toBe('unavailable');
            expect('events' in reading).toBe(false);
            expect(Reflect.get(reading, 'events')).toBeUndefined();
        }
    });

    it('reports engine underruns only while a dropout counter is wired', () => {
        wireDropoutCounter(true, 7);

        expect(collectAudioDeadlineEvidence().engineUnderruns).toEqual({ coverage: 'observed', events: 7 });

        wireDropoutCounter(false);

        const uncounted = collectAudioDeadlineEvidence().engineUnderruns;

        expect(uncounted.coverage).toBe('unavailable');
        expect('events' in uncounted).toBe(false);
    });

    it('reports no underrun coverage while the web engine runs with nothing counting dropouts', () => {
        vi.mocked(getEngineState).mockReturnValue(runningEngineState);
        // The counter answers zero from a buffer no worklet writes to; that is no
        // observation, not a clean run.
        wireDropoutCounter(false, 0);

        const reading = collectAudioDeadlineEvidence().engineUnderruns;

        expect(reading).toEqual({
            coverage: 'unavailable',
            reason: expect.stringContaining('cross-origin isolated'),
        });
        expect('events' in reading).toBe(false);
        expect(Reflect.get(reading, 'events')).toBeUndefined();
    });

    it('reports no underrun coverage once the transport that took the buffer has stopped', () => {
        wireDropoutCounter(false);
        // The buffer is allocated and handed out for the life of the page, so a
        // transport that took it and then stopped leaves it in place with its
        // tally standing. That tally is a finished run, not a live observation.
        expect(dropoutCounters.getSab()).not.toBeNull();
        startCountingTransport();
        stopCountingTransport();

        const reading = collectAudioDeadlineEvidence().engineUnderruns;

        expect(reading.coverage).toBe('unavailable');
        expect('events' in reading).toBe(false);
        expect(Reflect.get(reading, 'events')).toBeUndefined();
    });

    it('counts the accumulated stream-error events while the native engine runs', () => {
        engineRtDiagnosticsStore.set({
            latest: runningNativeDiagnostics,
            nativeEngineObserved: true,
            events: [
                { type: 'streamError', side: 'output', kind: 'xrun' },
                { type: 'streamError', side: 'input', kind: 'deviceBusy' },
            ],
        });

        expect(collectAudioDeadlineEvidence().nativeStreamFaults).toEqual({ coverage: 'observed', events: 2 });
    });

    it('counts the fault that stopped the stream, on the reading taken after rendering ceased', () => {
        // The live sequence: the error callback pushes the fault the instant
        // the output device fails, and the watchdog clears `running` about a
        // second later. A poll after that still reads an engine that exists —
        // its rate is the one its stream opened at — with the fault standing.
        engineRtDiagnosticsStore.set({
            latest: { ...runningNativeDiagnostics, running: false, outputStreamFault: 'deviceChanged' },
            nativeEngineObserved: true,
            events: [{ type: 'streamError', side: 'output', kind: 'deviceChanged' }],
        });

        expect(collectAudioDeadlineEvidence().nativeStreamFaults).toEqual({ coverage: 'observed', events: 1 });
    });

    it('keeps counting the fault after the engine that reported it was retired', async () => {
        // The live sequence, driven through the store's only writer: the error
        // callback pushes the fault, the watchdog clears `running`, and the
        // liveness watch then retires the abandoned backend, dropping its
        // handle. Every poll after that reads the no-engine shape while the
        // fault it already recorded still stands in the history.
        vi.mocked(getEngineRtDiagnostics).mockResolvedValueOnce({
            ...runningNativeDiagnostics,
            running: false,
            outputStreamFault: 'deviceChanged',
            events: [{ type: 'streamError', side: 'output', kind: 'deviceChanged' }],
        });
        await refreshEngineRtDiagnostics();

        vi.mocked(getEngineRtDiagnostics).mockResolvedValueOnce(notRunningEngineRtDiagnostics);
        await refreshEngineRtDiagnostics();

        const evidence = collectAudioDeadlineEvidence();

        expect(evidence.nativeStreamFaults).toEqual({ coverage: 'observed', events: 1 });
        // No engine is open to name, on the same reading that still counts the
        // fault: the count spans engine generations, the carrier entry does not.
        expect(evidence.workload.nativeEngine).toBeNull();
    });

    it('reports no native coverage until a reading from a native engine has been recorded', async () => {
        // The shape the native command answers with no engine handle, and the
        // shape the browser build reports: every reading zeroed, so no engine
        // whose faults could have been counted was ever read.
        vi.mocked(getEngineRtDiagnostics).mockResolvedValue(notRunningEngineRtDiagnostics);
        await refreshEngineRtDiagnostics();

        const reading = collectAudioDeadlineEvidence().nativeStreamFaults;

        expect(reading).toEqual({
            coverage: 'unavailable',
            reason: expect.stringContaining('no reading from a native engine has been recorded this session'),
        });
        expect('events' in reading).toBe(false);
    });

    it('reports the long-task count when the runtime observes them and no coverage when it does not', () => {
        vi.mocked(readMainThreadLongTasks).mockReturnValue(4);

        expect(collectAudioDeadlineEvidence().mainThreadLongTasks).toEqual({ coverage: 'observed', events: 4 });

        vi.mocked(readMainThreadLongTasks).mockReturnValue(LONG_TASK_OBSERVATION_UNSUPPORTED);

        const uncovered = collectAudioDeadlineEvidence().mainThreadLongTasks;

        expect(uncovered).toEqual({ coverage: 'unavailable', reason: expect.stringContaining('longtask') });
        expect('events' in uncovered).toBe(false);
    });

    it('keeps each carrier rate with its own engine while both carriers run at different rates', () => {
        // The live pairing: the web context is pinned to 48 kHz while the native
        // output opened at the device's 44.1 kHz default.
        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, sampleRate: 48_000 });
        engineRtDiagnosticsStore.set({
            latest: { ...runningNativeDiagnostics, sampleRate: 44_100, outputBufferFrames: 512 },
            nativeEngineObserved: true,
            events: [],
        });

        const workload = collectAudioDeadlineEvidence().workload;

        expect(workload.webEngine).toEqual({ sampleRate: 48_000 });
        expect(workload.nativeEngine).toEqual({ sampleRate: 44_100, outputBufferFrames: 512 });
    });

    it('leaves the native frames entry absent until a callback has published one', () => {
        // The slot is written only from inside the render callback, so an output
        // stream that has opened but never rendered still reads zero. Carrying
        // that zero beside a fault count would claim a buffer size nobody
        // produced.
        engineRtDiagnosticsStore.set({
            latest: { ...runningNativeDiagnostics, outputBufferFrames: 0 },
            nativeEngineObserved: true,
            events: [],
        });

        const { nativeEngine } = collectAudioDeadlineEvidence().workload;

        expect(nativeEngine).toEqual({ sampleRate: 48_000, outputBufferFrames: null });
    });

    it('correlates the reading to the workload it was taken under', () => {
        engineRtDiagnosticsStore.set({ latest: runningNativeDiagnostics, nativeEngineObserved: true, events: [] });
        trackStore.set({
            tracks: [
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
                { id: 'c', name: 'C' },
            ] as unknown as NonNullable<typeof trackStore.value>['tracks'],
            selectedTrackId: null,
            ghostClips: [],
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true });

        const evidence = collectAudioDeadlineEvidence();

        expect(evidence.version).toBe(1);
        expect(evidence.workload).toEqual({
            webEngine: { sampleRate: 48_000 },
            nativeEngine: { sampleRate: 48_000, outputBufferFrames: 256 },
            trackCount: 3,
            transport: 'recording',
        });
    });

    it('leaves the web carrier entry null while its context is not running', () => {
        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, state: 'closed', isReady: false });
        engineRtDiagnosticsStore.set({ latest: runningNativeDiagnostics, nativeEngineObserved: true, events: [] });

        const workload = collectAudioDeadlineEvidence().workload;

        expect(workload.webEngine).toBeNull();
        expect(workload.nativeEngine).toEqual({ sampleRate: 48_000, outputBufferFrames: 256 });
    });

    it('keeps naming the native carrier on a reading taken after rendering stopped', () => {
        // A stream that stopped rendering still has its handle and the rate it
        // negotiated, so the engine is open and there is a carrier to name.
        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, sampleRate: 44_100 });
        engineRtDiagnosticsStore.set({
            latest: { ...runningNativeDiagnostics, running: false, sampleRate: 44_100, outputBufferFrames: 512 },
            nativeEngineObserved: true,
            events: [{ type: 'streamError', side: 'output', kind: 'deviceNotAvailable' }],
        });

        const workload = collectAudioDeadlineEvidence().workload;

        expect(workload.webEngine).toEqual({ sampleRate: 44_100 });
        expect(workload.nativeEngine).toEqual({ sampleRate: 44_100, outputBufferFrames: 512 });
    });

    it('leaves the native carrier entry null when no native engine reading is on record', () => {
        engineRtDiagnosticsStore.set({
            latest: notRunningEngineRtDiagnostics,
            nativeEngineObserved: false,
            events: [],
        });

        expect(collectAudioDeadlineEvidence().workload.nativeEngine).toBeNull();

        engineRtDiagnosticsStore.set(defaultEngineRtDiagnosticsState);

        expect(collectAudioDeadlineEvidence().workload.nativeEngine).toBeNull();
    });

    it('reads the transport state a reading was taken under', () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: false });
        expect(collectAudioDeadlineEvidence().workload.transport).toBe('playing');

        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
        expect(collectAudioDeadlineEvidence().workload.transport).toBe('stopped');
    });
});
