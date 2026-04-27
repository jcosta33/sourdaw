import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAutomationRecording } from '../stopAutomationRecording';

type TestTrack = {
    id: string;
    kind: 'audio';
    automationMode: 'read' | 'write' | 'touch' | 'latch';
};

const {
    activeRecording,
    pendingPoints,
    touchActive,
    findLaneId,
    clearPointsInRange,
    flushPendingPoints,
    trackSnapshot,
} = vi.hoisted(() => {
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
        flushPendingPoints: vi.fn(),
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

vi.mock('../recordingSessionState', () => ({
    activeRecording,
    pendingPoints,
    touchActive,
    findLaneId,
    clearPointsInRange,
    flushPendingPoints,
}));

function setTracks(tracks: TestTrack[]): void {
    trackSnapshot.value = { tracks };
}

describe('stopAutomationRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        pendingPoints.clear();
        touchActive.clear();
        findLaneId.mockReturnValue(null);
        setTracks([]);
    });

    it('handles an empty track snapshot', () => {
        stopAutomationRecording();

        expect(flushPendingPoints).not.toHaveBeenCalled();
    });

    it('flushes each active session then clears all recording maps', () => {
        const session = {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.5 as number | null,
        };
        activeRecording.set('t1::gain', session);
        pendingPoints.set('t1::gain', []);
        touchActive.add('t1::gain');

        stopAutomationRecording();

        expect(flushPendingPoints).toHaveBeenCalledWith('t1::gain');
        expect(activeRecording.size).toBe(0);
        expect(pendingPoints.size).toBe(0);
        expect(touchActive.size).toBe(0);
    });

    it('invokes clearPointsInRange for latch mode when a lane exists and pending points extend the session', () => {
        findLaneId.mockReturnValue('lane-a');
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'latch' }]);

        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 4,
            lastValue: 1,
        });
        pendingPoints.set('t1::gain', [
            { beat: 4, value: 1, curve: 'linear', tension: 0 },
            { beat: 8, value: 0.5, curve: 'linear', tension: 0 },
        ]);

        stopAutomationRecording();

        expect(clearPointsInRange).toHaveBeenCalledWith('lane-a', 4, 8);
        expect(flushPendingPoints).toHaveBeenCalledWith('t1::gain');
    });
});
