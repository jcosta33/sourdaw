import { describe, expect, it, vi, beforeEach } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { commitInlineAutomationPaint } from '../commitInlineAutomationPaint';

const mocks = vi.hoisted(() => ({
    addAutomationLane: vi.fn(),
    batchAddAutomationPoints: vi.fn(),
    getAutomationLanes: vi.fn(),
    pushUndoEntry: vi.fn(),
    removeAutomationLane: vi.fn(),
    removeAutomationPoint: vi.fn(),
    replaceAutomationLanePoints: vi.fn(),
    // Identity passthrough: this spec proves the inline-paint commit ROUTES the
    // drawn stroke through the shared gesture-thinning use case; the real
    // decimation behaviour is proven directly in simplifyGesturePoints.spec.ts.
    // Keeping it a barrel-level mock avoids a cross-module deep import.
    simplifyGesturePoints: vi.fn((points: unknown) => points),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    addAutomationLane: mocks.addAutomationLane,
    batchAddAutomationPoints: mocks.batchAddAutomationPoints,
    getAutomationLanes: mocks.getAutomationLanes,
    removeAutomationLane: mocks.removeAutomationLane,
    removeAutomationPoint: mocks.removeAutomationPoint,
    replaceAutomationLanePoints: mocks.replaceAutomationLanePoints,
    simplifyGesturePoints: mocks.simplifyGesturePoints,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
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
        const points: AutomationPoint[] = [
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
        const undoEntryCall = mocks.pushUndoEntry.mock.calls[0];
        if (!undoEntryCall) {
            throw new Error('expected pushUndoEntry to have been called');
        }
        expect(undoEntryCall[0]).toBe('Draw 2 automation points');

        const undo = undoEntryCall[1];
        const redo = undoEntryCall[2];
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

        const undoEntryCall = mocks.pushUndoEntry.mock.calls[0];
        if (!undoEntryCall) {
            throw new Error('expected pushUndoEntry to have been called');
        }
        const undo = undoEntryCall[1];
        const redo = undoEntryCall[2];
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

        const undoEntryCall = mocks.pushUndoEntry.mock.calls[0];
        if (!undoEntryCall) {
            throw new Error('expected pushUndoEntry to have been called');
        }
        const undo = undoEntryCall[1];
        undo();

        expect(mocks.removeAutomationLane).toHaveBeenCalledWith('lane-created');
    });

    it('routes the drawn stroke through the shared gesture-thinning use case, persisting its result', () => {
        const dense: AutomationPoint[] = [];
        for (let index = 0; index <= 10; index += 1) {
            dense.push({ beat: index * 0.1, value: index * 0.05, curve: 'linear', tension: 0 });
        }

        commitInlineAutomationPaint({
            laneId: 'lane-1',
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: dense,
        });

        // The commit thins the cloned stroke through the shared RDP use case, then
        // persists exactly what that use case returned (its real decimation is
        // proven in simplifyGesturePoints.spec.ts).
        expect(mocks.simplifyGesturePoints).toHaveBeenCalledTimes(1);
        expect(mocks.simplifyGesturePoints.mock.calls[0]![0]).toEqual(dense);
        const thinned = mocks.simplifyGesturePoints.mock.results[0]!.value;
        expect(mocks.batchAddAutomationPoints).toHaveBeenCalledWith('lane-1', thinned);
    });

    it('rejects an empty stroke before reading or mutating any automation lane', () => {
        expect(
            commitInlineAutomationPaint({
                laneId: 'lane-1',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [],
            })
        ).toBe(false);

        expect(mocks.batchAddAutomationPoints).not.toHaveBeenCalled();
        expect(mocks.addAutomationLane).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects an explicit lane id that does not resolve to a known lane', () => {
        mocks.getAutomationLanes.mockReturnValue([]);

        expect(
            commitInlineAutomationPaint({
                laneId: 'missing-lane',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }],
            })
        ).toBe(false);

        // With an explicit lane id that is absent, no lane is created — the
        // caller pinned the destination and it does not exist.
        expect(mocks.addAutomationLane).not.toHaveBeenCalled();
        expect(mocks.batchAddAutomationPoints).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('uses the singular undo label for a one-point stroke and rebuilds the lane on redo', () => {
        // No existing lane and no explicit laneId: commit creates a fresh lane.
        // The lane resolves on creation, then a follow-up lookup returns null so
        // the commit falls back to the drawn (thinned) points for redo.
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
            // Post-commit lookup returns nothing -> nextPoints falls back to `points`.
            .mockReturnValueOnce([]);

        const point: AutomationPoint = { beat: 1, value: 0.5, curve: 'linear', tension: 0 };
        expect(
            commitInlineAutomationPaint({
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [point],
            })
        ).toBe(true);

        const undoEntryCall = mocks.pushUndoEntry.mock.calls[0];
        if (!undoEntryCall) {
            throw new Error('expected pushUndoEntry to have been called');
        }
        // Singular label: one point -> no trailing 's'.
        expect(undoEntryCall[0]).toBe('Draw 1 automation point');

        // Redo with no prior snapshot recreates the lane and replays the points.
        // Configure createTargetLane's second lookup to resolve a fresh lane id.
        mocks.getAutomationLanes.mockReturnValueOnce([
            {
                id: 'lane-redone',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [],
            },
        ]);
        const redo = undoEntryCall[2];
        redo();

        expect(mocks.replaceAutomationLanePoints).toHaveBeenCalledWith({ laneId: 'lane-redone', points: [point] });
    });
});
