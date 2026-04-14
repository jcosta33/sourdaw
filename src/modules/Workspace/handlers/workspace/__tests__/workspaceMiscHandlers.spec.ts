import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetSnapValue } from '../handleSetSnapValue';
import { handleSetMarkerColor } from '../handleSetMarkerColor';
import { handleAddAutomationLane } from '../handleAddAutomationLane';
import { handleAddAutomationPoint } from '../handleAddAutomationPoint';
import { handleRemoveAutomationPoint } from '../handleRemoveAutomationPoint';

import { setSnapValue } from '../../../useCases/togglePanel/panelToggles/setSnapValue';
import { setMarkerColor } from '#/modules/Arrangement/useCases';
import { addAutomationLane, addAutomationPoint, getAutomationStoreState, removeAutomationPoint } from '#/modules/Automation';

vi.mock('../../../useCases/togglePanel/panelToggles/setSnapValue', () => ({ setSnapValue: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases', () => ({ setMarkerColor: vi.fn() }));
vi.mock('#/modules/Automation', () => ({
    addAutomationLane: vi.fn(),
    addAutomationPoint: vi.fn(),
    removeAutomationPoint: vi.fn(),
    getAutomationStoreState: vi.fn(),
}));

describe('Workspace Misc Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleSetSnapValue should delegate to setSnapValue', () => {
        handleSetSnapValue.execute({ type: 'setSnapValue', payload: { value: 0.5 } });
        expect(setSnapValue).toHaveBeenCalledWith(0.5);
    });

    it('handleSetMarkerColor should delegate to setMarkerColor', () => {
        handleSetMarkerColor.execute({ type: 'setMarkerColor', payload: { markerId: 'm1', color: '#fff' } });
        expect(setMarkerColor).toHaveBeenCalledWith('m1', '#fff');
    });

    it('handleAddAutomationLane should delegate to addAutomationLane', () => {
        handleAddAutomationLane.execute({ type: 'addAutomationLane', payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain' } });
        expect(addAutomationLane).toHaveBeenCalledWith('t1', 'gain', 'Gain');
    });

    it('handleAddAutomationPoint should delegate to addAutomationPoint', () => {
        handleAddAutomationPoint.execute({ type: 'addAutomationPoint', payload: { laneId: 'l1', beat: 4, value: 0.5 } });
        expect(addAutomationPoint).toHaveBeenCalledWith('l1', { beat: 4, value: 0.5, curve: 'linear', tension: 0 });
    });

    it('handleRemoveAutomationPoint should delegate to removeAutomationPoint', () => {
        vi.mocked(getAutomationStoreState).mockReturnValue({
            lanes: [{ id: 'l1', points: [{ beat: 4, value: 0.5, curve: 'linear', tension: 0 }] }]
        } as any);
        
        handleRemoveAutomationPoint.execute({ type: 'removeAutomationPoint', payload: { laneId: 'l1', pointIndex: 0 } });
        expect(removeAutomationPoint).toHaveBeenCalledWith('l1', 4);
    });

    it('handleRemoveAutomationPoint should do nothing if state is missing or out of bounds', () => {
        vi.mocked(getAutomationStoreState).mockReturnValue({
            lanes: [{ id: 'l1', points: [] }]
        } as any);
        
        handleRemoveAutomationPoint.execute({ type: 'removeAutomationPoint', payload: { laneId: 'l1', pointIndex: 0 } });
        expect(removeAutomationPoint).not.toHaveBeenCalled();
    });
});
