import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeLink = vi.fn();

vi.mock('../helpers', () => ({
    invokeLink: (...args: unknown[]) => invokeLink(...args),
}));

import { linkStopPlaying } from '../linkStopPlaying';

describe('linkStopPlaying', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invokeLink.mockResolvedValue(undefined);
    });

    it('should invoke link_stop_playing', async () => {
        await linkStopPlaying();
        expect(invokeLink).toHaveBeenCalledTimes(1);
        expect(invokeLink).toHaveBeenCalledWith('link_stop_playing');
    });
});
