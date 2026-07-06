import { describe, it, expect, vi, beforeEach } from 'vitest';

import { recordAutomationValue } from '../recordAutomationValue';
import { setAutomationRecordingDependencies } from '../recordingDependencies';

type TestTrack = {
    id: string;
    kind: 'audio';
    automationMode: 'read' | 'write' | 'touch' | 'latch';
};

const { activeRecording, pendingPoints, touchActive, trackSnapshot, transportSnapshot, warn } = vi.hoisted(() => {
    const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
    const pendingPoints = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
    const touchActive = new Set<string>();
    const trackSnapshot: { value: { tracks: TestTrack[] } | null } = { value: null };
    const transportSnapshot: { value: { tempo: number } | null } = { value: { tempo: 120 } };
    return {
        activeRecording,
        pendingPoints,
        touchActive,
        trackSnapshot,
        transportSnapshot,
        warn: vi.fn(),
    };
});

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            get value() {
                return trackSnapshot.value;
            },
        },
    };
});

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: {
            get value() {
                return transportSnapshot.value;
            },
        },
    };
});

vi.mock('../recordingSessionState', () => ({
    RECORDING_MODES: new Set(['write', 'touch', 'latch']),
    activeRecording,
    pendingPoints,
    touchActive,
}));

function setTracks(tracks: TestTrack[]): void {
    trackSnapshot.value = { tracks };
}

describe('recordAutomationValue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        pendingPoints.clear();
        touchActive.clear();
        trackSnapshot.value = null;
        transportSnapshot.value = { tempo: 120 };
        setAutomationRecordingDependencies({
            getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as AudioContext,
            getCompensationDelay: () => 0,
        });
    });

    it('does nothing when the track is missing', () => {
        setTracks([]);

        recordAutomationValue('t1', 'gain', 0.5, 4);

        expect(pendingPoints.size).toBe(0);
    });

    it('does nothing when automation mode is not a recording mode', () => {
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'read' }]);

        recordAutomationValue('t1', 'gain', 0.5, 4);

        expect(pendingPoints.size).toBe(0);
    });

    it('records a pending point in write mode', () => {
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        recordAutomationValue('t1', 'gain', 0.75, 8);

        const key = 't1::gain';
        expect(pendingPoints.get(key)).toEqual([
            expect.objectContaining({ beat: 8, value: 0.75, curve: 'linear', tension: 0 }),
        ]);
        expect(activeRecording.get(key)?.lastValue).toBe(0.75);
    });

    // Regression (Batch B fix 3): write mode used to call clearPointsInRange on
    // EVERY value at ~100Hz (a full lane re-map + filter). Recording now only
    // buffers — the recorded span is cleared once at flush (stopAutomationRecording).
    it('buffers multiple write-mode values for stop-time clearing and flush', () => {
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        recordAutomationValue('t1', 'gain', 0.5, 4);
        recordAutomationValue('t1', 'gain', 0.6, 5);
        recordAutomationValue('t1', 'gain', 0.7, 6);

        expect(pendingPoints.get('t1::gain')?.map((point) => point.beat)).toEqual([4, 5, 6]);
    });

    it('records a pending point in touch mode and marks the key as touch-active', () => {
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'touch' }]);

        recordAutomationValue('t1', 'pan', -0.2, 2);

        const key = 't1::pan';
        expect(touchActive.has(key)).toBe(true);
        expect(pendingPoints.get(key)?.[0]).toMatchObject({ beat: 2, value: -0.2 });
    });

    // Regression (Batch B fix 4): before the transport store hydrates its tempo
    // is unknown. Recording then would convert beats with a guessed 120 BPM and
    // misplace points silently. It must skip + warn instead.
    it('drops the value and warns when the transport store is not hydrated', () => {
        transportSnapshot.value = null;
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        recordAutomationValue('t1', 'gain', 0.5, 4);

        expect(pendingPoints.size).toBe(0);
        expect(activeRecording.size).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    // Regression (Batch B fix 3): tempo is captured at the session's first value
    // and reused, so a mid-session tempo change does not re-time recorded beats.
    it('captures tempo at the first value and ignores a mid-session tempo change', () => {
        // Non-zero latency makes the beat->second conversion tempo-sensitive.
        setAutomationRecordingDependencies({
            getAudioContext: () => ({ baseLatency: 0, outputLatency: 0.5 }) as AudioContext,
            getCompensationDelay: () => 0,
        });
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        transportSnapshot.value = { tempo: 60 };
        recordAutomationValue('t1', 'gain', 0.5, 4); // offset = 0.5s * 60/60 = 0.5 beats -> 3.5
        const key = 't1::gain';
        const session = activeRecording.get(key);
        expect(session?.tempoAtStart).toBe(60);

        transportSnapshot.value = { tempo: 240 }; // would give offset 2 beats if re-read
        recordAutomationValue('t1', 'gain', 0.6, 8); // still uses 60 BPM -> offset 0.5 -> 7.5

        expect(session?.tempoAtStart).toBe(60);
        expect(pendingPoints.get(key)?.map((point) => point.beat)).toEqual([3.5, 7.5]);
    });
});
