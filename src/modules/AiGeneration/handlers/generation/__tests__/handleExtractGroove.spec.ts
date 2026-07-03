import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleExtractGroove } from '../handleExtractGroove';

const sampleTemplate = {
    id: 'extracted-c1',
    name: 'Extracted from c1',
    subdivisions: 16,
    offsets: [0],
    velocities: [1],
};

vi.mock('../../../useCases/grooveTemplate/operations/extractGroove', () => ({
    extractGroove: vi.fn(() => sampleTemplate),
}));

vi.mock('../../../useCases/grooveTemplate/registerExtractedGroove', () => ({
    registerExtractedGroove: vi.fn(),
}));

describe('generation handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleExtractGroove forwards clip id', async () => {
        const { extractGroove } = await import('../../../useCases/grooveTemplate/operations/extractGroove');

        void handleExtractGroove.execute({ type: 'extractGroove', payload: { clipId: 'c1' } });

        expect(extractGroove).toHaveBeenCalledWith('c1');
    });

    it('persists the extracted template to the registry so apply can find it', async () => {
        const { registerExtractedGroove } = await import('../../../useCases/grooveTemplate/registerExtractedGroove');

        void handleExtractGroove.execute({ type: 'extractGroove', payload: { clipId: 'c1' } });

        // Pre-fix the return was discarded; now it is registered for later apply.
        expect(registerExtractedGroove).toHaveBeenCalledWith(sampleTemplate);
    });
});
