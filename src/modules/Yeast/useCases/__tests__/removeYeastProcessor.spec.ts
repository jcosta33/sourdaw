import { beforeEach, describe, expect, it, vi } from 'vitest';

const setProjection = vi.hoisted(() => vi.fn());
const removeGrooveAssignments = vi.hoisted(() => vi.fn());
const reconcileGrooveAssignments = vi.hoisted(() => vi.fn());

vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeProjection: setProjection,
}));
vi.mock('../reconcileYeastGrooveAssignments', () => ({ reconcileYeastGrooveAssignments: reconcileGrooveAssignments }));
vi.mock('../removeYeastGrooveAssignments', () => ({
    removeYeastGrooveAssignments: removeGrooveAssignments,
}));

import { yeastStore } from '../../stores/yeastStore';
import { removeYeastProcessor } from '../removeYeastProcessor';

describe('removeYeastProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        reconcileGrooveAssignments.mockReturnValue(false);
        yeastStore.set({
            processors: [
                { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: {} },
                { id: 'filter-1', type: 'filter', name: 'Note Filter', bypassed: false, params: {} },
            ],
            uiLevel: 1,
        });
    });

    it('writes the remaining projection and sends one complete runtime snapshot', () => {
        reconcileGrooveAssignments.mockReturnValueOnce(true);
        removeGrooveAssignments.mockReturnValueOnce(true);
        expect(removeYeastProcessor('arp-1')).toBe(true);

        expect(yeastStore.value?.processors).toEqual([
            { id: 'filter-1', type: 'filter', name: 'Note Filter', bypassed: false, params: {} },
        ]);
        expect(setProjection).toHaveBeenCalledWith([{ id: 'filter-1', type: 'filter', bypassed: false, params: {} }]);
        expect(removeGrooveAssignments).toHaveBeenCalledWith('arp-1');
    });

    it('does not write or issue a runtime command for an unknown id', () => {
        expect(removeYeastProcessor('not-a-real-id')).toBe(false);

        expect(yeastStore.value?.processors).toHaveLength(2);
        expect(setProjection).not.toHaveBeenCalled();
        expect(removeGrooveAssignments).not.toHaveBeenCalled();
    });
});
