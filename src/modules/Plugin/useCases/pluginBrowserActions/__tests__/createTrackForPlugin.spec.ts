import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrackForPlugin } from '../createTrackForPlugin';

const mocks = vi.hoisted(() => ({
    addTrack: vi.fn<typeof import('#/modules/Arrangement/useCases').addTrack>(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addTrack: mocks.addTrack,
}));

describe('createTrackForPlugin', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to addTrack use case', () => {
        mocks.addTrack.mockReturnValue({ id: 't1' });

        const result = createTrackForPlugin('My Plugin', 'midi');

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'My Plugin', kind: 'midi' });
        expect(result).toEqual({ id: 't1' });
    });
});
