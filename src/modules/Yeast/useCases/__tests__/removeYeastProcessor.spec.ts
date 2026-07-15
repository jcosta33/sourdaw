import { beforeEach, describe, expect, it, vi } from 'vitest';

const setProjection = vi.hoisted(() => vi.fn());

vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeProjection: setProjection,
}));

import { yeastStore } from '../../stores/yeastStore';
import { removeYeastProcessor } from '../removeYeastProcessor';

describe('removeYeastProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        yeastStore.set({
            processors: [
                { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: {} },
                { id: 'filter-1', type: 'filter', name: 'Note Filter', bypassed: false, params: {} },
            ],
            uiLevel: 1,
        });
    });

    it('writes the remaining projection and sends one complete runtime snapshot', () => {
        removeYeastProcessor('arp-1');

        expect(yeastStore.value.processors).toEqual([
            { id: 'filter-1', type: 'filter', name: 'Note Filter', bypassed: false, params: {} },
        ]);
        expect(setProjection).toHaveBeenCalledWith([{ id: 'filter-1', type: 'filter', bypassed: false, params: {} }]);
    });

    it('does not write or issue a runtime command for an unknown id', () => {
        removeYeastProcessor('not-a-real-id');

        expect(yeastStore.value.processors).toHaveLength(2);
        expect(setProjection).not.toHaveBeenCalled();
    });
});
