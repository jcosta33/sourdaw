import { describe, it, expect, vi, beforeEach } from 'vitest';

type Step = { active: boolean };
type Track = { padIndex: number; steps: Step[] };
type Pattern = { id: string; tracks: Track[] };
type Kit = { activePatternId: string; patterns: Pattern[] };
type Instances = Record<string, { kit: Kit }>;

const DEVICE_ID = 'd1';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = { value: null as Record<string, { kit: Kit }> | null };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../stores/toasterStore', () => ({
    toasterStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

import { applyEuclideanToTrack } from '../applyEuclidean';

describe('applyEuclideanToTrack', () => {
    beforeEach(() => {
        mockStore.value = {
            [DEVICE_ID]: {
                kit: {
                    activePatternId: 'p1',
                    patterns: [
                        {
                            id: 'p1',
                            tracks: [
                                {
                                    padIndex: 0,
                                    steps: Array.from({ length: 8 }, () => ({ active: false })),
                                },
                            ],
                        },
                    ],
                },
            },
        };
        setMock.mockClear();
    });

    it('writes a euclidean rhythm with the requested hit count', () => {
        applyEuclideanToTrack(DEVICE_ID, 0, 3, 8);
        const next = setMock.mock.calls[0]![0] as Instances;
        const updated = next[DEVICE_ID]!.kit.patterns[0]!.tracks[0]!.steps;
        expect(updated.filter((s) => s.active).length).toBe(3);
    });

    it('noops when the active pattern is missing', () => {
        mockStore.value = { [DEVICE_ID]: { kit: { activePatternId: 'missing', patterns: [] } } };
        applyEuclideanToTrack(DEVICE_ID, 0, 4, 8);
        expect(setMock).not.toHaveBeenCalled();
    });
});
