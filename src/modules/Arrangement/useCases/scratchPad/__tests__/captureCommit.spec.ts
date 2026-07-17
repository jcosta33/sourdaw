import { describe, it, expect, beforeEach, vi } from 'vitest';

import { captureArrangementToScratchPad } from '../captureCommit/captureArrangementToScratchPad';
import { commitScratchPadToArrangement } from '../captureCommit/commitScratchPadToArrangement';

import type { MarkerStoreState } from '#/modules/Arrangement/stores/markerStore';
import type { ScratchPadStoreState } from '#/modules/Arrangement/stores/scratchPadStore';

const { markerStoreMock, scratchPadStoreMock } = vi.hoisted(() => ({
    markerStoreMock: {
        value: null as MarkerStoreState | null,
        set: vi.fn<(value: MarkerStoreState | null) => void>(),
    },
    scratchPadStoreMock: {
        value: null as ScratchPadStoreState | null,
        set: vi.fn<(value: ScratchPadStoreState | null) => void>(),
    },
}));

vi.mock('../../../stores/markerStore', () => ({
    markerStore: markerStoreMock,
}));

vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: scratchPadStoreMock,
}));

describe('captureArrangementToScratchPad', () => {
    beforeEach(() => {
        markerStoreMock.set.mockReset();
        scratchPadStoreMock.set.mockReset();
        markerStoreMock.value = null;
        scratchPadStoreMock.value = null;
    });

    it('copies sorted arrangement sections into the scratch pad store', () => {
        markerStoreMock.value = {
            markers: [],
            sections: [
                { id: 's2', startBeat: 8, endBeat: 16, name: 'B', color: '#00f' },
                { id: 's1', startBeat: 0, endBeat: 4, name: 'A', color: '#f00' },
            ],
        };
        scratchPadStoreMock.value = { sections: [] };

        captureArrangementToScratchPad();

        expect(scratchPadStoreMock.set).toHaveBeenCalledTimes(1);
        const next = scratchPadStoreMock.set.mock.calls[0]?.[0];
        if (!next) {
            throw new Error('expected scratchPadStore.set to receive a state');
        }
        expect(next.sections).toHaveLength(2);
        expect(next.sections[0]?.name).toBe('A');
        expect(next.sections[1]?.name).toBe('B');
    });

    it('no-ops when there are no sections', () => {
        markerStoreMock.value = { markers: [], sections: [] };
        scratchPadStoreMock.value = { sections: [] };

        captureArrangementToScratchPad();
        expect(scratchPadStoreMock.set).not.toHaveBeenCalled();
    });
});

describe('commitScratchPadToArrangement', () => {
    beforeEach(() => {
        markerStoreMock.set.mockReset();
        scratchPadStoreMock.set.mockReset();
        markerStoreMock.value = null;
        scratchPadStoreMock.value = null;
    });

    it('writes scratch sections back to the marker store', () => {
        scratchPadStoreMock.value = {
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
        };
        markerStoreMock.value = {
            markers: [],
            sections: [{ id: 'old', startBeat: 99, endBeat: 100, name: 'X', color: '#000' }],
        };

        commitScratchPadToArrangement();

        expect(markerStoreMock.set).toHaveBeenCalledTimes(1);
        const next = markerStoreMock.set.mock.calls[0]?.[0];
        if (!next) {
            throw new Error('expected markerStore.set to receive a state');
        }
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0]?.name).toBe('A');
        expect(next.sections[0]?.startBeat).toBe(0);
    });
});
