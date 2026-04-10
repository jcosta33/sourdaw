import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleExtractGroove } from './handleExtractGroove';

vi.mock('../../useCases/grooveTemplate/operations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../useCases/grooveTemplate/operations')>();
    return {
        ...actual,
        extractGroove: vi.fn(),
    };
});

describe('generation handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleExtractGroove forwards clip id', async () => {
        const { extractGroove } = await import('../../useCases/grooveTemplate/operations');

        handleExtractGroove.execute({ type: 'extractGroove', payload: { clipId: 'c1' } });

        expect(extractGroove).toHaveBeenCalledWith('c1');
    });
});
