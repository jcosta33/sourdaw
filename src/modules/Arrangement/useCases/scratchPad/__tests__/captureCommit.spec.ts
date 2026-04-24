import { describe, it, expect, beforeEach, vi } from 'vitest';

import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';
import { captureArrangementToScratchPad } from '../captureCommit/captureArrangementToScratchPad';
import { commitScratchPadToArrangement } from '../captureCommit/commitScratchPadToArrangement';

import type { MarkerStoreState } from '#/modules/Arrangement/stores/markerStore';
import type { ScratchPadStoreState } from '#/modules/Arrangement/stores/scratchPadStore';

vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        value: null as MarkerStoreState | null,
        set: vi.fn(),
    },
}));

vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        value: null as ScratchPadStoreState | null,
        set: vi.fn(),
    },
}));

describe('captureArrangementToScratchPad', () => {
    beforeEach(() => {
        vi.mocked(markerStore.set).mockReset();
        vi.mocked(scratchPadStore.set).mockReset();
        markerStore.value = null as unknown as MarkerStoreState;
        scratchPadStore.value = null as unknown as ScratchPadStoreState;
    });

    it('copies sorted arrangement sections into the scratch pad store', () => {
        markerStore.value = {
            markers: [],
            sections: [
                { id: 's2', startBeat: 8, endBeat: 16, name: 'B', color: '#00f' },
                { id: 's1', startBeat: 0, endBeat: 4, name: 'A', color: '#f00' },
            ],
        } as unknown as MarkerStoreState;
        scratchPadStore.value = { sections: [] } as unknown as ScratchPadStoreState;

        captureArrangementToScratchPad();

        expect(scratchPadStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(scratchPadStore.set).mock.calls[0]![0] as {
            sections: { name: string; startBeat: number }[];
        };
        expect(next.sections).toHaveLength(2);
        expect(next.sections[0]!.name).toBe('A');
        expect(next.sections[1]!.name).toBe('B');
    });

    it('no-ops when there are no sections', () => {
        markerStore.value = { markers: [], sections: [] } as unknown as MarkerStoreState;
        scratchPadStore.value = { sections: [] } as unknown as ScratchPadStoreState;

        captureArrangementToScratchPad();
        expect(scratchPadStore.set).not.toHaveBeenCalled();
    });
});

describe('commitScratchPadToArrangement', () => {
    beforeEach(() => {
        vi.mocked(markerStore.set).mockReset();
        vi.mocked(scratchPadStore.set).mockReset();
        markerStore.value = null as unknown as MarkerStoreState;
        scratchPadStore.value = null as unknown as ScratchPadStoreState;
    });

    it('writes scratch sections back to the marker store', () => {
        scratchPadStore.value = {
            sections: [
                {
                    id: 'sp1',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'A',
                    color: '#f00',
                    order: 0,
                },
            ],
        } as unknown as ScratchPadStoreState;
        markerStore.value = {
            markers: [],
            sections: [{ id: 'old', startBeat: 99, endBeat: 100, name: 'X', color: '#000' }],
        } as unknown as MarkerStoreState;

        commitScratchPadToArrangement();

        expect(markerStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(markerStore.set).mock.calls[0]![0] as {
            sections: { name: string; startBeat: number }[];
        };
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0]!.name).toBe('A');
        expect(next.sections[0]!.startBeat).toBe(0);
    });
});
