import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setVcaGain } from '../setVcaGain';

const mockGetVcaGroupsState = vi.fn();
const mockSetVcaGroupsState = vi.fn();
vi.mock('../../../stores/vcaGroupStore', () => ({
    getVcaGroupsState: () => mockGetVcaGroupsState(),
    setVcaGroupsState: (...args: any[]) => mockSetVcaGroupsState(...args)
}));

describe('setVcaGain', () => {
    beforeEach(() => {
        mockGetVcaGroupsState.mockReset();
        mockSetVcaGroupsState.mockReset();
    });

    it('clamps gain and writes groups via injected setters', () => {
        mockGetVcaGroupsState.mockReturnValue([
            { id: 'g1', name: 'A', gain: 1, muted: false, trackIds: [] },
            { id: 'g2', name: 'B', gain: 0.5, muted: false, trackIds: [] },
        ]);

        setVcaGain('g1', 3);

        expect(mockSetVcaGroupsState).toHaveBeenCalledTimes(1);
        const next = mockSetVcaGroupsState.mock.calls[0]![0] as { id: string; gain: number }[];
        expect(next.find((g) => g.id === 'g1')!.gain).toBe(2);
        expect(next.find((g) => g.id === 'g2')!.gain).toBe(0.5);
    });
});
