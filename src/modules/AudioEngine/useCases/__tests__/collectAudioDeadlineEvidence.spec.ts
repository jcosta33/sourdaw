import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { LONG_TASK_OBSERVATION_UNSUPPORTED, readMainThreadLongTasks } from '../../services/mainThreadLongTaskLatch';
import { defaultEngineRtDiagnosticsState, engineRtDiagnosticsStore } from '../../stores/engineRtDiagnosticsStore';
import { collectAudioDeadlineEvidence } from '../collectAudioDeadlineEvidence';
import { getEngineHealth } from '../engineAccess/getEngineHealth';
import { getEngineState } from '../engineAccess/getEngineState';

import type { AudioEngineHealth, AudioEngineState } from '../../models/AudioEngineState';
import type { EngineRtDiagnostics } from '../../models/EngineRtDiagnostics';

vi.mock('../engineAccess/getEngineState', () => ({ getEngineState: vi.fn() }));
vi.mock('../engineAccess/getEngineHealth', () => ({ getEngineHealth: vi.fn() }));
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

function engineHealthWithUnderruns(detectedUnderrunBlocks: number): AudioEngineHealth {
    return {
        workletReady: true,
        lastInitError: null,
        lastResumeError: null,
        dropouts: { detectedUnderrunBlocks, silentFrames: 0, lastUnderrunAtFrame: 0 },
    };
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
        vi.mocked(getEngineHealth).mockReturnValue(engineHealthWithUnderruns(0));
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
        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, state: 'suspended' });

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

    it('reports engine underruns only while the web engine is running', () => {
        vi.mocked(getEngineHealth).mockReturnValue(engineHealthWithUnderruns(7));

        expect(collectAudioDeadlineEvidence().engineUnderruns).toEqual({ coverage: 'observed', events: 7 });

        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, state: 'closed', isReady: false });

        const stopped = collectAudioDeadlineEvidence().engineUnderruns;

        expect(stopped.coverage).toBe('unavailable');
        expect('events' in stopped).toBe(false);
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
            sampleRate: 48_000,
            outputBufferFrames: 256,
            trackCount: 3,
            transport: 'recording',
        });
    });

    it('carries the web engine sample rate alongside its underrun count when no native diagnostics exist', () => {
        vi.mocked(getEngineState).mockReturnValue({ ...runningEngineState, sampleRate: 44_100 });
        vi.mocked(getEngineHealth).mockReturnValue(engineHealthWithUnderruns(5));

        const evidence = collectAudioDeadlineEvidence();

        expect(evidence.engineUnderruns).toEqual({ coverage: 'observed', events: 5 });
        expect(evidence.workload.sampleRate).toBe(44_100);
    });

    it('reads the transport state a reading was taken under', () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: false });
        expect(collectAudioDeadlineEvidence().workload.transport).toBe('playing');

        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
        expect(collectAudioDeadlineEvidence().workload.transport).toBe('stopped');
    });
});
