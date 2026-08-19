import { beforeEach, describe, expect, it, vi } from 'vitest';

const setProjection = vi.hoisted(() => vi.fn());
const reconcileGrooveAssignments = vi.hoisted(() => vi.fn());

vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeProjection: setProjection,
}));
vi.mock('../reconcileYeastGrooveAssignments', () => ({
    reconcileYeastGrooveAssignments: reconcileGrooveAssignments,
}));

import { yeastStore } from '../../stores/yeastStore';
import { reorderYeastProcessor } from '../reorderYeastProcessor';

describe('reorderYeastProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        yeastStore.set({
            processors: [
                { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: {} },
                { id: 'filter-1', type: 'filter', name: 'Note Filter', bypassed: false, params: {} },
                { id: 'transpose-1', type: 'transposer', name: 'Transposer', bypassed: false, params: {} },
            ],
            uiLevel: 1,
        });
    });

    it('moves the processor at fromIdx to toIdx, shifting the ones in between', () => {
        reorderYeastProcessor(0, 2);

        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual([
            'filter-1',
            'transpose-1',
            'arp-1',
        ]);
    });

    it('moves a later processor earlier the same way', () => {
        reorderYeastProcessor(2, 0);

        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual([
            'transpose-1',
            'arp-1',
            'filter-1',
        ]);
    });

    it('commits through the single write path: one runtime projection, one groove reconciliation', () => {
        reorderYeastProcessor(0, 1);

        expect(setProjection).toHaveBeenCalledOnce();
        expect(setProjection).toHaveBeenCalledWith([
            { id: 'filter-1', type: 'filter', bypassed: false, params: {} },
            { id: 'arp-1', type: 'arpeggiator', bypassed: false, params: {} },
            { id: 'transpose-1', type: 'transposer', bypassed: false, params: {} },
        ]);
        expect(reconcileGrooveAssignments).toHaveBeenCalledOnce();
    });

    it('is a no-op for an adjacent swap applied twice — the list returns to its start order', () => {
        reorderYeastProcessor(0, 1);
        reorderYeastProcessor(0, 1);

        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual([
            'arp-1',
            'filter-1',
            'transpose-1',
        ]);
    });

    it.each([
        ['negative fromIdx', -1, 1],
        ['fromIdx past the end', 3, 1],
        ['negative toIdx', 0, -1],
        ['toIdx past the end', 0, 3],
    ])('guards out-of-range indices without writing or issuing a runtime command (%s)', (_label, fromIdx, toIdx) => {
        reorderYeastProcessor(fromIdx, toIdx);

        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual([
            'arp-1',
            'filter-1',
            'transpose-1',
        ]);
        expect(setProjection).not.toHaveBeenCalled();
        expect(reconcileGrooveAssignments).not.toHaveBeenCalled();
    });

    it('is a no-op when fromIdx equals toIdx, but still commits (matches other single-write-path mutations)', () => {
        reorderYeastProcessor(1, 1);

        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual([
            'arp-1',
            'filter-1',
            'transpose-1',
        ]);
        expect(setProjection).toHaveBeenCalledOnce();
    });
});
