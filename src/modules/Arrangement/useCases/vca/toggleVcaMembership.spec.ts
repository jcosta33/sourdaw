import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/models/Track';
import { assignTrackToVCA, removeTrackFromVCA } from '../vcaFader';
import { toggleVcaMembership } from './toggleVcaMembership';

vi.mock('../vcaFader', () => ({
    assignTrackToVCA: vi.fn(),
    removeTrackFromVCA: vi.fn(),
}));

describe('toggleVcaMembership', () => {
    beforeEach(() => {
        vi.mocked(assignTrackToVCA).mockClear();
        vi.mocked(removeTrackFromVCA).mockClear();
    });

    it('should do nothing when track is missing', () => {
        const getTrackById = vi.fn(() => undefined);
        injectDependencies(toggleVcaMembership, { getTrackById });

        toggleVcaMembership('t1', 'g1');

        expect(assignTrackToVCA).not.toHaveBeenCalled();
        expect(removeTrackFromVCA).not.toHaveBeenCalled();
    });

    it('should remove when track is already in the group', () => {
        const track = { vcaGroupId: 'g1' } as unknown as Track;
        const getTrackById = vi.fn(() => track);
        injectDependencies(toggleVcaMembership, { getTrackById });

        toggleVcaMembership('t1', 'g1');

        expect(removeTrackFromVCA).toHaveBeenCalledWith('t1');
        expect(assignTrackToVCA).not.toHaveBeenCalled();
    });

    it('should assign when track is in another or no group', () => {
        const track = { vcaGroupId: null } as unknown as Track;
        const getTrackById = vi.fn(() => track);
        injectDependencies(toggleVcaMembership, { getTrackById });

        toggleVcaMembership('t1', 'g2');

        expect(assignTrackToVCA).toHaveBeenCalledWith('t1', 'g2');
        expect(removeTrackFromVCA).not.toHaveBeenCalled();
    });
});
