import { describe, it, expect, vi, beforeEach } from 'vitest';

const { automationStoreValue, automationStoreSet } = vi.hoisted(() => ({
    automationStoreValue: {
        value: {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    points: [
                        { id: 'p-before', beat: 3, value: 0.25, curve: 'linear' },
                        { id: 'p-at', beat: 4, value: 0.5, curve: 'linear' },
                        { id: 'p-after', beat: 6, value: 0.75, curve: 'linear' },
                    ],
                },
            ],
        },
    },
    automationStoreSet: vi.fn(),
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return automationStoreValue.value;
        },
        set: automationStoreSet,
    },
}));

import { shiftAutomationAfterBeat } from '../shiftAutomationAfterBeat';

describe('shiftAutomationAfterBeat', () => {
    beforeEach(() => {
        automationStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    points: [
                        { id: 'p-before', beat: 3, value: 0.25, curve: 'linear' },
                        { id: 'p-at', beat: 4, value: 0.5, curve: 'linear' },
                        { id: 'p-after', beat: 6, value: 0.75, curve: 'linear' },
                    ],
                },
            ],
        };
        automationStoreSet.mockClear();
    });

    it('should shift automation points at or after the insertion beat', () => {
        shiftAutomationAfterBeat({ atBeat: 4, deltaBeats: 2 });

        expect(automationStoreSet).toHaveBeenCalledWith({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    points: [
                        { id: 'p-before', beat: 3, value: 0.25, curve: 'linear' },
                        { id: 'p-at', beat: 6, value: 0.5, curve: 'linear' },
                        { id: 'p-after', beat: 8, value: 0.75, curve: 'linear' },
                    ],
                },
            ],
        });
    });

    it('should re-sort points when a negative delta shifts them past an earlier point', () => {
        automationStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    points: [
                        { id: 'p-5', beat: 5, value: 0.1, curve: 'linear' },
                        { id: 'p-10', beat: 10, value: 0.5, curve: 'linear' },
                        { id: 'p-15', beat: 15, value: 0.9, curve: 'linear' },
                    ],
                },
            ],
        };

        shiftAutomationAfterBeat({ atBeat: 10, deltaBeats: -8 });

        expect(automationStoreSet).toHaveBeenCalledWith({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    points: [
                        { id: 'p-10', beat: 2, value: 0.5, curve: 'linear' },
                        { id: 'p-5', beat: 5, value: 0.1, curve: 'linear' },
                        { id: 'p-15', beat: 7, value: 0.9, curve: 'linear' },
                    ],
                },
            ],
        });
    });
});
