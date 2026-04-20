import { describe, it, expect, vi, beforeEach } from 'vitest';

import { recordAutomationValue } from '../recordAutomationValue';

const { activeRecording, pendingPoints, touchActive, findLaneId, clearPointsInRange } = vi.hoisted(() => {
    const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
    const pendingPoints = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
    const touchActive = new Set<string>();
    return {
        activeRecording,
        pendingPoints,
        touchActive,
        findLaneId: vi.fn(() => null as string | null),
        clearPointsInRange: vi.fn(),
    };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...mod,
        getTrackById: vi.fn(),
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

import { getTrackById } from '#/modules/Arrangement/useCases';

describe('recordAutomationValue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        pendingPoints.clear();
        touchActive.clear();
        findLaneId.mockReturnValue(null);
    });

    it('does nothing when the track is missing', () => {
        vi.mocked(getTrackById).mockReturnValue(undefined);

        recordAutomationValue('t1', 'gain', 0.5, 4);

        expect(pendingPoints.size).toBe(0);
    });

    it('does nothing when automation mode is not a recording mode', () => {
        vi.mocked(getTrackById).mockReturnValue({
            id: 't1',
            kind: 'audio',
            automationMode: 'read',
        } as any);

        recordAutomationValue('t1', 'gain', 0.5, 4);

        expect(pendingPoints.size).toBe(0);
    });

    it('records a pending point in write mode and skips lane clears when no lane exists', () => {
        vi.mocked(getTrackById).mockReturnValue({
            id: 't1',
            kind: 'audio',
            automationMode: 'write',
        } as any);

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
        vi.mocked(getTrackById).mockReturnValue({
            id: 't1',
            kind: 'audio',
            automationMode: 'write',
        } as any);

        recordAutomationValue('t1', 'gain', 0.5, 4);

        expect(clearPointsInRange).toHaveBeenCalledWith('lane-1', 4, 4);
    });

    it('records a pending point in touch mode and marks the key as touch-active', () => {
        vi.mocked(getTrackById).mockReturnValue({
            id: 't1',
            kind: 'audio',
            automationMode: 'touch',
        } as any);

        recordAutomationValue('t1', 'pan', -0.2, 2);

        const key = 't1::pan';
        expect(touchActive.has(key)).toBe(true);
        expect(pendingPoints.get(key)?.[0]).toMatchObject({ beat: 2, value: -0.2 });
    });
});
