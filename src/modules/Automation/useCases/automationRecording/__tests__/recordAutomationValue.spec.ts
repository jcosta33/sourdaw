import { describe, it, expect, vi, beforeEach } from 'vitest';

import { recordAutomationValue } from '../recordAutomationValue';

type TestTrack = {
    id: string;
    kind: 'audio';
    automationMode: 'read' | 'write' | 'touch' | 'latch';
};

const { activeRecording, pendingPoints, touchActive, findLaneId, clearPointsInRange, trackSnapshot } = vi.hoisted(() => {
    const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
    const pendingPoints = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
    const touchActive = new Set<string>();
    const trackSnapshot: { value: { tracks: TestTrack[] } | null } = { value: null };
    return {
        activeRecording,
        pendingPoints,
        touchActive,
        findLaneId: vi.fn(() => null as string | null),
        clearPointsInRange: vi.fn(),
        trackSnapshot,
    };
});

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

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        getAudioContext: vi.fn(() => ({ baseLatency: 0, outputLatency: 0 })),
        getCompensationDelay: vi.fn(() => 0),
    };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        getTransportStoreValue: vi.fn(() => ({ tempo: 120 })),
    };
});

vi.mock('../recordingSessionState', () => ({
    RECORDING_MODES: new Set(['write', 'touch', 'latch']),
    activeRecording,
    pendingPoints,
    touchActive,
    makeKey: (trackId: string, parameterId: string) => `${trackId}::${parameterId}`,
    findLaneId,
    clearPointsInRange,
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
        findLaneId.mockReturnValue(null);
        trackSnapshot.value = null;
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

    it('records a pending point in write mode and skips lane clears when no lane exists', () => {
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        recordAutomationValue('t1', 'gain', 0.75, 8);

        expect(clearPointsInRange).not.toHaveBeenCalled();
        const key = 't1::gain';
        expect(pendingPoints.get(key)).toEqual([
            expect.objectContaining({ beat: 8, value: 0.75, curve: 'linear', tension: 0 }),
        ]);
        expect(activeRecording.get(key)?.lastValue).toBe(0.75);
    });

    it('clears existing lane points in write mode when a lane is resolved', () => {
        findLaneId.mockReturnValue('lane-1');
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        recordAutomationValue('t1', 'gain', 0.5, 4);

        expect(clearPointsInRange).toHaveBeenCalledWith('lane-1', 4, 4);
    });

    it('records a pending point in touch mode and marks the key as touch-active', () => {
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'touch' }]);

        recordAutomationValue('t1', 'pan', -0.2, 2);

        const key = 't1::pan';
        expect(touchActive.has(key)).toBe(true);
        expect(pendingPoints.get(key)?.[0]).toMatchObject({ beat: 2, value: -0.2 });
    });
});
