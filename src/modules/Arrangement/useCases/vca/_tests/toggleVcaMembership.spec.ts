import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Track } from '#/modules/Arrangement/models/Track';
import { assignTrackToVCA } from '../../vcaFader/assignTrackToVCA';
import { removeTrackFromVCA } from '../../vcaFader/removeTrackFromVCA';
import { toggleVcaMembership } from '../toggleVcaMembership';

vi.mock('../../vcaFader/removeTrackFromVCA', () => ({
    removeTrackFromVCA: vi.fn(),
}));

vi.mock('../../vcaFader/assignTrackToVCA', () => ({
    assignTrackToVCA: vi.fn(),
}));

const mockGetTrackById = vi.fn();
vi.mock('#/modules/Arrangement/repositories/track/getTrackById', () => ({
    getTrackById: (...args: any[]) => mockGetTrackById(...args)
}));

describe('toggleVcaMembership', () => {
    beforeEach(() => {
        vi.mocked(assignTrackToVCA).mockClear();
        vi.mocked(removeTrackFromVCA).mockClear();
        mockGetTrackById.mockReset();
    });

    it('should do nothing when track is missing', () => {
        mockGetTrackById.mockReturnValue(undefined);

        toggleVcaMembership('t1', 'g1');

        expect(assignTrackToVCA).not.toHaveBeenCalled();
        expect(removeTrackFromVCA).not.toHaveBeenCalled();
    });

    it('should remove when track is already in the group', () => {
        const track = { vcaGroupId: 'g1' } as unknown as Track;
        mockGetTrackById.mockReturnValue(track);

        toggleVcaMembership('t1', 'g1');

        expect(removeTrackFromVCA).toHaveBeenCalledWith('t1');
        expect(assignTrackToVCA).not.toHaveBeenCalled();
    });

    it('should assign when track is in another or no group', () => {
        const track = { vcaGroupId: null } as unknown as Track;
        mockGetTrackById.mockReturnValue(track);

        toggleVcaMembership('t1', 'g2');

        expect(assignTrackToVCA).toHaveBeenCalledWith('t1', 'g2');
        expect(removeTrackFromVCA).not.toHaveBeenCalled();
    });
});
