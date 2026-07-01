import { describe, it, expect, vi, beforeEach } from 'vitest';

type InvokeLink = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeLink = vi.fn<InvokeLink>();

vi.mock('../invokeLink', () => ({
    invokeLink: (...args: Parameters<InvokeLink>): ReturnType<InvokeLink> => invokeLink(...args),
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
