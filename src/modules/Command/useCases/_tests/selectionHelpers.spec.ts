import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSelectedTrackId } from '../selectionHelpers/getSelectedTrackId';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(),
}));

describe('getSelectedTrackId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when track state is unavailable', async () => {
        const { getTrackStoreState } = await import('#/modules/Arrangement/useCases');
        vi.mocked(getTrackStoreState).mockReturnValue(null);

        expect(getSelectedTrackId()).toBeNull();
    });
});
