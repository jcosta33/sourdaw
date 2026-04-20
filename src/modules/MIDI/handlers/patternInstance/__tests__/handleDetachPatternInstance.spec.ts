import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDetachPatternInstance } from '../handleDetachPatternInstance';

vi.mock('../../../useCases/patternInstance/detachPatternInstance', () => ({
    detachPatternInstance: vi.fn(),
}));

vi.mock('../../../useCases/patternInstance/createPatternInstance', () => ({
    createPatternInstance: vi.fn(),
}));

import { detachPatternInstance } from '../../../useCases/patternInstance/detachPatternInstance';

describe('handleDetachPatternInstance', () => {
    beforeEach(() => {
        vi.mocked(detachPatternInstance).mockClear();
    });

    it('forwards clip id', async () => {
        await handleDetachPatternInstance.execute({
            type: 'detachPatternInstance',
            payload: { clipId: 'c1' },
        });

        expect(detachPatternInstance).toHaveBeenCalledWith('c1');
    });
});
