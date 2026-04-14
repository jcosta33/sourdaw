import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeLink = vi.fn();

vi.mock('../helpers', () => ({
    invokeLink: (...args: unknown[]) => invokeLink(...args),
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
