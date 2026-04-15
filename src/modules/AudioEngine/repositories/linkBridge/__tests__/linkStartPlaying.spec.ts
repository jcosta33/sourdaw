import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeLink = vi.fn();

vi.mock('../helpers', () => ({
    invokeLink: (...args: unknown[]) => invokeLink(...args),
}));

import { linkStartPlaying } from '../linkStartPlaying';

describe('linkStartPlaying', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invokeLink.mockResolvedValue(undefined);
    });

    it('should invoke link_start_playing', async () => {
        await linkStartPlaying();
        expect(invokeLink).toHaveBeenCalledTimes(1);
        expect(invokeLink).toHaveBeenCalledWith('link_start_playing');
    });
});
