import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleExtractGroove } from '../handlers/generation/handleExtractGroove';

vi.mock('./grooveTemplate/operations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./grooveTemplate/operations')>();
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
        const { extractGroove } = await import('./grooveTemplate/operations');

        handleExtractGroove.execute({ type: 'extractGroove', payload: { clipId: 'c1' } });

        expect(extractGroove).toHaveBeenCalledWith('c1');
    });
});
