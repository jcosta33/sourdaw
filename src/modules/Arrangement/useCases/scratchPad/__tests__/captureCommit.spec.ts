import { describe, it, expect, beforeEach, vi } from 'vitest';

import { captureArrangementToScratchPad } from '../captureCommit/captureArrangementToScratchPad';
import { commitScratchPadToArrangement } from '../captureCommit/commitScratchPadToArrangement';

const mockMarkerSet = vi.fn();
let mockMarkerValue: any = null;
vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mockMarkerValue;
        },
        set: (value: any) => mockMarkerSet(value),
    },
}));

const mockScratchPadSet = vi.fn();
let mockScratchPadValue: any = null;
vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        get value() {
            return mockScratchPadValue;
        },
        set: (value: any) => mockScratchPadSet(value),
    },
}));

describe('captureArrangementToScratchPad', () => {
    beforeEach(() => {
        mockMarkerSet.mockReset();
        mockScratchPadSet.mockReset();
    });

    it('copies sorted arrangement sections into the scratch pad store', () => {
        mockMarkerValue = {
            markers: [],
            sections: [
                { id: 's2', startBeat: 8, endBeat: 16, name: 'B', color: '#00f' },
                { id: 's1', startBeat: 0, endBeat: 4, name: 'A', color: '#f00' },
            ],
        };
        mockScratchPadValue = { sections: [] };

        captureArrangementToScratchPad();

        expect(mockScratchPadSet).toHaveBeenCalledTimes(1);
        const next = mockScratchPadSet.mock.calls[0]![0] as { sections: { name: string; startBeat: number }[] };
        expect(next.sections).toHaveLength(2);
        expect(next.sections[0]!.name).toBe('A');
        expect(next.sections[1]!.name).toBe('B');
    });

    it('no-ops when there are no sections', () => {
        mockMarkerValue = { markers: [], sections: [] };
        mockScratchPadValue = { sections: [] };

        captureArrangementToScratchPad();
        expect(mockScratchPadSet).not.toHaveBeenCalled();
    });
});

describe('commitScratchPadToArrangement', () => {
    beforeEach(() => {
        mockMarkerSet.mockReset();
        mockScratchPadSet.mockReset();
    });

    it('writes scratch sections back to the marker store', () => {
        mockScratchPadValue = {
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
        mockMarkerValue = {
            markers: [],
            sections: [{ id: 'old', startBeat: 99, endBeat: 100, name: 'X', color: '#000' }],
        };

        commitScratchPadToArrangement();

        expect(mockMarkerSet).toHaveBeenCalledTimes(1);
        const next = mockMarkerSet.mock.calls[0]![0] as { sections: { name: string; startBeat: number }[] };
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0]!.name).toBe('A');
        expect(next.sections[0]!.startBeat).toBe(0);
    });
});
