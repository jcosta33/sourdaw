import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { dropoutCounters } from '../../engine/dropoutCounter';
import { LONG_TASK_OBSERVATION_UNSUPPORTED, readMainThreadLongTasks } from '../../services/mainThreadLongTaskLatch';
import { defaultEngineRtDiagnosticsState, engineRtDiagnosticsStore } from '../../stores/engineRtDiagnosticsStore';
import { collectAudioDeadlineEvidence } from '../collectAudioDeadlineEvidence';
import { getEngineState } from '../engineAccess/getEngineState';

import type { AudioEngineState } from '../../models/AudioEngineState';
import type { EngineRtDiagnostics } from '../../models/EngineRtDiagnostics';

vi.mock('../engineAccess/getEngineState', () => ({ getEngineState: vi.fn() }));
vi.mock('../../engine/dropoutCounter', () => ({
    dropoutCounters: { hasCoverage: vi.fn(), read: vi.fn() },
}));
vi.mock('../../services/mainThreadLongTaskLatch', () => ({
    LONG_TASK_OBSERVATION_UNSUPPORTED: 'unsupported',
    readMainThreadLongTasks: vi.fn(),
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

/** Stands in for the counter's own tally; `detectedUnderrunBlocks` is the figure the collector reads. */
function dropoutTally(detectedUnderrunBlocks: number) {
    return { detectedUnderrunBlocks, silentFrames: detectedUnderrunBlocks * 128, lastUnderrunAtFrame: 0 };
}

/** Coverage and count come from the same object, so a case states both together. */
function wireDropoutCounter(coverage: boolean, detectedUnderrunBlocks = 0): void {
    vi.mocked(dropoutCounters.hasCoverage).mockReturnValue(coverage);
    vi.mocked(dropoutCounters.read).mockReturnValue(dropoutTally(detectedUnderrunBlocks));
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

    it('counts the accumulated stream-error events while the native engine runs', () => {
        engineRtDiagnosticsStore.set({
            latest: runningNativeDiagnostics,
            events: [
                { type: 'streamError', side: 'output', kind: 'xrun' },
                { type: 'streamError', side: 'input', kind: 'deviceBusy' },
            ],
        });

        expect(collectAudioDeadlineEvidence().nativeStreamFaults).toEqual({ coverage: 'observed', events: 2 });
    });

    it('reports no native coverage when the native engine is not running, even with events on record', () => {
        engineRtDiagnosticsStore.set({
            latest: { ...runningNativeDiagnostics, running: false },
            events: [{ type: 'streamError', side: 'output', kind: 'deviceChanged' }],
        });

        const reading = collectAudioDeadlineEvidence().nativeStreamFaults;

        expect(reading.coverage).toBe('unavailable');
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
            events: [],
        });

        const workload = collectAudioDeadlineEvidence().workload;

        expect(workload.webEngine).toEqual({ sampleRate: 48_000 });
        expect(workload.nativeEngine).toEqual({ sampleRate: 44_100, outputBufferFrames: 512 });
    });

    it('correlates the reading to the workload it was taken under', () => {
        engineRtDiagnosticsStore.set({ latest: runningNativeDiagnostics, events: [] });
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

    it('leaves a carrier entry null while that carrier is not running', () => {
        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, state: 'closed', isReady: false });

        const stopped = collectAudioDeadlineEvidence().workload;

        expect(stopped.webEngine).toBeNull();
        expect(stopped.nativeEngine).toBeNull();

        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, sampleRate: 44_100 });
        engineRtDiagnosticsStore.set({ latest: { ...runningNativeDiagnostics, running: false }, events: [] });

        const webOnly = collectAudioDeadlineEvidence().workload;

        expect(webOnly.webEngine).toEqual({ sampleRate: 44_100 });
        expect(webOnly.nativeEngine).toBeNull();
    });

    it('reads the transport state a reading was taken under', () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: false });
        expect(collectAudioDeadlineEvidence().workload.transport).toBe('playing');

        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
        expect(collectAudioDeadlineEvidence().workload.transport).toBe('stopped');
    });
});
