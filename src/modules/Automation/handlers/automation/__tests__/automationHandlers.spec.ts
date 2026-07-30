import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addAutomationLane } from '../../../useCases/automation/addAutomationLane';
import { addAutomationPoint } from '../../../useCases/automation/addAutomationPoint';
import { quantizeAutomationBeats } from '../../../useCases/automation/quantizeAutomationBeats';
import { removeAutomationPoint } from '../../../useCases/automation/removeAutomationPoint';
import { removeAutomationPointById } from '../../../useCases/automation/removeAutomationPointById';
import { reverseAutomation } from '../../../useCases/automation/reverseAutomation';
import { scaleAutomationValues } from '../../../useCases/automation/scaleAutomationValues';
import { stretchAutomationTime } from '../../../useCases/automation/stretchAutomationTime';
import { thinAutomationPoints } from '../../../useCases/automation/thinAutomationPoints';
import { getAutomationStoreState } from '../../../useCases/getAutomationStoreState';
import { handleAddAutomationLane } from '../handleAddAutomationLane';
import { handleAddAutomationPoint } from '../handleAddAutomationPoint';
import { handleQuantizeAutomation } from '../handleQuantizeAutomation';
import { handleRemoveAutomationPoint } from '../handleRemoveAutomationPoint';
import { handleReverseAutomation } from '../handleReverseAutomation';
import { handleScaleAutomation } from '../handleScaleAutomation';
import { handleStretchAutomation } from '../handleStretchAutomation';
import { handleThinAutomation } from '../handleThinAutomation';

vi.mock('../../../useCases/automation/addAutomationLane', () => ({ addAutomationLane: vi.fn() }));
vi.mock('../../../useCases/automation/addAutomationPoint', () => ({ addAutomationPoint: vi.fn() }));
vi.mock('../../../useCases/automation/removeAutomationPoint', () => ({ removeAutomationPoint: vi.fn() }));
vi.mock('../../../useCases/automation/removeAutomationPointById', () => ({ removeAutomationPointById: vi.fn() }));
vi.mock('../../../useCases/automation/quantizeAutomationBeats', () => ({ quantizeAutomationBeats: vi.fn() }));
vi.mock('../../../useCases/automation/reverseAutomation', () => ({ reverseAutomation: vi.fn() }));
vi.mock('../../../useCases/automation/scaleAutomationValues', () => ({ scaleAutomationValues: vi.fn() }));
vi.mock('../../../useCases/automation/stretchAutomationTime', () => ({ stretchAutomationTime: vi.fn() }));
vi.mock('../../../useCases/automation/thinAutomationPoints', () => ({ thinAutomationPoints: vi.fn() }));
vi.mock('../../../useCases/getAutomationStoreState', () => ({ getAutomationStoreState: vi.fn() }));

describe('Automation Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getAutomationStoreState).mockReturnValue({
            lanes: [
                {
                    id: 'l1',
                    trackId: 't1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    minValue: 0,
                    maxValue: 1,
                    points: [{ beat: 4, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    color: '#fff',
                },
            ],
        });
    });

    it('handleAddAutomationLane should delegate to addAutomationLane', () => {
        void handleAddAutomationLane.execute({
            type: 'addAutomationLane',
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'lane-1' },
        });
        expect(addAutomationLane).toHaveBeenCalledWith('t1', 'gain', 'Gain', 'lane-1');
    });

    it('writes the canonical existing lane id onto a no-op replay action', () => {
        const action: Parameters<NonNullable<typeof handleAddAutomationLane.isNoop>>[0] = {
            type: 'addAutomationLane',
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain' },
        };

        expect(handleAddAutomationLane.isNoop?.(action)).toBe(true);
        expect(action.payload.laneId).toBe('l1');
    });

    it('handleAddAutomationPoint should delegate to addAutomationPoint', () => {
        void handleAddAutomationPoint.execute({
            type: 'addAutomationPoint',
            payload: { laneId: 'l1', pointId: 'point-1', beat: 4, value: 0.5 },
        });
        expect(addAutomationPoint).toHaveBeenCalledWith('l1', {
            id: 'point-1',
            beat: 4,
            value: 0.5,
            curve: 'linear',
            tension: 0,
        });
    });

    it('describes point insertion with a stable-id inverse', () => {
        const description = handleAddAutomationPoint.describe({
            type: 'addAutomationPoint',
            payload: { laneId: 'l1', pointId: 'point-2', beat: 8, value: 0.75 },
        });

        expect(description.inverseAction).toEqual({
            type: 'removeAutomationPoint',
            payload: { laneId: 'l1', pointIndex: 1, pointId: 'point-2' },
        });
    });

    it('handleRemoveAutomationPoint should remove by lane and point index', () => {
        void handleRemoveAutomationPoint.execute({
            type: 'removeAutomationPoint',
            payload: { laneId: 'l1', pointIndex: 0 },
        });
        expect(removeAutomationPoint).toHaveBeenCalledWith('l1', 4);
    });

    it('removes an added point by stable identity after an earlier collaborative insertion shifts its index', () => {
        vi.mocked(getAutomationStoreState).mockReturnValue({
            lanes: [
                {
                    id: 'l1',
                    trackId: 't1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    minValue: 0,
                    maxValue: 1,
                    points: [
                        { id: 'remote-point', beat: 2, value: 0.25, curve: 'linear', tension: 0 },
                        { id: 'ai-point', beat: 4, value: 0.5, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                },
            ],
        });

        void handleRemoveAutomationPoint.execute({
            type: 'removeAutomationPoint',
            payload: { laneId: 'l1', pointIndex: 0, pointId: 'ai-point' },
        });

        expect(removeAutomationPointById).toHaveBeenCalledWith('l1', 'ai-point');
        expect(removeAutomationPoint).not.toHaveBeenCalled();
    });

    it('handleQuantizeAutomation should delegate to quantizeAutomationBeats', () => {
        void handleQuantizeAutomation.execute({
            type: 'quantizeAutomation',
            payload: { laneId: 'l1', gridSize: 0.25 },
        });
        expect(quantizeAutomationBeats).toHaveBeenCalledWith('l1', 0.25);
    });

    it('handleReverseAutomation should delegate to reverseAutomation', () => {
        void handleReverseAutomation.execute({
            type: 'reverseAutomation',
            payload: { laneId: 'l1' },
        });
        expect(reverseAutomation).toHaveBeenCalledWith('l1');
    });

    it('handleScaleAutomation should delegate to scaleAutomationValues', () => {
        void handleScaleAutomation.execute({
            type: 'scaleAutomation',
            payload: { laneId: 'l1', factor: 2, anchor: 0.5 },
        });
        expect(scaleAutomationValues).toHaveBeenCalledWith('l1', 2, 0.5);
    });

    it('handleStretchAutomation should delegate to stretchAutomationTime', () => {
        void handleStretchAutomation.execute({
            type: 'stretchAutomation',
            payload: { laneId: 'l1', factor: 1.5, anchorBeat: 10 },
        });
        expect(stretchAutomationTime).toHaveBeenCalledWith('l1', 1.5, 10);
    });

    it('handleThinAutomation should delegate to thinAutomationPoints', () => {
        void handleThinAutomation.execute({
            type: 'thinAutomation',
            payload: { laneId: 'l1', tolerance: 0.05 },
        });
        expect(thinAutomationPoints).toHaveBeenCalledWith('l1', 0.05);
    });
});
