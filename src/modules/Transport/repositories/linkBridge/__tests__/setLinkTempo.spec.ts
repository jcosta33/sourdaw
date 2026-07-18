import { describe, it, expect, vi, beforeEach } from 'vitest';

type InvokeLink = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeLink = vi.fn<InvokeLink>();

vi.mock('../invokeLink', () => ({
    invokeLink: (...args: Parameters<InvokeLink>): ReturnType<InvokeLink> => invokeLink(...args),
}));

import { setLinkTempo } from '../setLinkTempo';

describe('setLinkTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invokeLink.mockResolvedValue(undefined);
    });

    it('should invoke set_link_tempo with the given tempo', async () => {
        await setLinkTempo(128.5);
        expect(invokeLink).toHaveBeenCalledTimes(1);
        expect(invokeLink).toHaveBeenCalledWith('set_link_tempo', { tempo: 128.5 });
    });
});
