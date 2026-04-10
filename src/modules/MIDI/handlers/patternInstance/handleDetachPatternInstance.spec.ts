import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDetachPatternInstance } from './handleDetachPatternInstance';

vi.mock('../../useCases/patternInstance', () => ({
    createPatternInstance: vi.fn(),
    detachPatternInstance: vi.fn(),
}));

import { detachPatternInstance } from '../../useCases/patternInstance';

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
