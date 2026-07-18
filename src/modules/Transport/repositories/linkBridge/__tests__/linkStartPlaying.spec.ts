import { describe, it, expect, vi, beforeEach } from 'vitest';

type InvokeLink = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeLink = vi.fn<InvokeLink>();

vi.mock('../invokeLink', () => ({
    invokeLink: (...args: Parameters<InvokeLink>): ReturnType<InvokeLink> => invokeLink(...args),
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
