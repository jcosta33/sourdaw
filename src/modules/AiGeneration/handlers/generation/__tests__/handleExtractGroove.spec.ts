import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleExtractGroove } from '../handleExtractGroove';

vi.mock('../../../useCases/grooveTemplate/operations/extractGroove', () => ({
    extractGroove: vi.fn(),
}));

describe('generation handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleExtractGroove forwards clip id', async () => {
        const { extractGroove } = await import('../../../useCases/grooveTemplate/operations/extractGroove');

        handleExtractGroove.execute({ type: 'extractGroove', payload: { clipId: 'c1' } });

        expect(extractGroove).toHaveBeenCalledWith('c1');
    });
});
