import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { getPatternInstances } from '../patternInstance/getPatternInstances';
import { getTrackStoreState } from '#/modules/Arrangement/useCases';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getTrackStoreState: vi.fn(),
}));

describe('getPatternInstances', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(getTrackStoreState).mockReset();
    });

    it('returns an empty list when track state is unavailable', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null);

        expect(getPatternInstances('parent')).toEqual([]);
    });
});
