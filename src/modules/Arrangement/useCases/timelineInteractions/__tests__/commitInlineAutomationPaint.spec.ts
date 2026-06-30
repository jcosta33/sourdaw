import { describe, expect, it, vi, beforeEach } from 'vitest';

import { commitInlineAutomationPaint } from '../commitInlineAutomationPaint';

const mocks = vi.hoisted(() => ({
    addAutomationLane: vi.fn(),
    batchAddAutomationPoints: vi.fn(),
    getAutomationLanes: vi.fn(),
    pushUndoEntry: vi.fn(),
    removeAutomationLane: vi.fn(),
    removeAutomationPoint: vi.fn(),
    replaceAutomationLanePoints: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    addAutomationLane: mocks.addAutomationLane,
    batchAddAutomationPoints: mocks.batchAddAutomationPoints,
    getAutomationLanes: mocks.getAutomationLanes,
    removeAutomationLane: mocks.removeAutomationLane,
    removeAutomationPoint: mocks.removeAutomationPoint,
    replaceAutomationLanePoints: mocks.replaceAutomationLanePoints,
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

describe('commitInlineAutomationPaint', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getAutomationLanes.mockReturnValue([
            {
                id: 'lane-1',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [],
            },
        ]);
    });

    it('should batch painted points through the automation use case and own undo', () => {
        const points = [
            { beat: 1, value: 0.25, curve: 'linear', tension: 0 },
            { beat: 2, value: 0.5, curve: 'linear', tension: 0 },
        ];
        mocks.getAutomationLanes
            .mockReturnValueOnce([
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [],
                },
            ])
            .mockReturnValueOnce([
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points,
                },
            ]);

        const committed = commitInlineAutomationPaint({
            laneId: 'lane-1',
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points,
        });

        expect(committed).toBe(true);
        expect(mocks.batchAddAutomationPoints).toHaveBeenCalledWith('lane-1', points);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        expect(mocks.pushUndoEntry.mock.calls[0][0]).toBe('Draw 2 automation points');

        const undo = mocks.pushUndoEntry.mock.calls[0][1];
        const redo = mocks.pushUndoEntry.mock.calls[0][2];
        undo();
        redo();

        expect(mocks.replaceAutomationLanePoints).toHaveBeenCalledWith({ laneId: 'lane-1', points: [] });
        expect(mocks.replaceAutomationLanePoints).toHaveBeenCalledWith({ laneId: 'lane-1', points });
    });

    it('should restore overwritten points on undo when paint merges with existing automation', () => {
        const previousPoints = [
            { beat: 1, value: 0.2, curve: 'linear', tension: 0 },
            { beat: 3, value: 0.7, curve: 'linear', tension: 0 },
        ];
        const nextPoints = [{ beat: 1, value: 0.9, curve: 'linear', tension: 0 }, previousPoints[1]];
        mocks.getAutomationLanes
            .mockReturnValueOnce([
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: previousPoints,
                },
            ])
            .mockReturnValueOnce([
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: nextPoints,
                },
            ]);

        const committed = commitInlineAutomationPaint({
            laneId: 'lane-1',
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [{ beat: 1.02, value: 0.9, curve: 'linear', tension: 0 }],
        });

        expect(committed).toBe(true);

        const undo = mocks.pushUndoEntry.mock.calls[0][1];
        const redo = mocks.pushUndoEntry.mock.calls[0][2];
        undo();
        redo();

        expect(mocks.replaceAutomationLanePoints).toHaveBeenNthCalledWith(1, {
            laneId: 'lane-1',
            points: previousPoints,
        });
        expect(mocks.replaceAutomationLanePoints).toHaveBeenNthCalledWith(2, {
            laneId: 'lane-1',
            points: nextPoints,
        });
        expect(mocks.removeAutomationPoint).not.toHaveBeenCalled();
    });

    it('should create the target lane through Automation before committing when needed', () => {
        mocks.getAutomationLanes
            .mockReturnValueOnce([])
            .mockReturnValueOnce([
                {
                    id: 'lane-created',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [],
                },
            ])
            .mockReturnValueOnce([
                {
                    id: 'lane-created',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ beat: 1, value: 0.25, curve: 'linear', tension: 0 }],
                },
            ]);

        const committed = commitInlineAutomationPaint({
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [{ beat: 1, value: 0.25, curve: 'linear', tension: 0 }],
        });

        expect(committed).toBe(true);
        expect(mocks.addAutomationLane).toHaveBeenCalledWith('track-1', 'gain', 'Gain');
        expect(mocks.batchAddAutomationPoints).toHaveBeenCalledWith('lane-created', [
            { beat: 1, value: 0.25, curve: 'linear', tension: 0 },
        ]);

        const undo = mocks.pushUndoEntry.mock.calls[0][1];
        undo();

        expect(mocks.removeAutomationLane).toHaveBeenCalledWith('lane-created');
    });
});
