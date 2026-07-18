import { beforeEach, describe, expect, it, vi } from 'vitest';

const linkBridgeMocks = vi.hoisted(() => ({
    disableLink: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../../repositories/linkBridge/disableLink', () => ({
    disableLink: linkBridgeMocks.disableLink,
}));

import { disableLink } from '../disableLink';

describe('disableLink', () => {
    beforeEach(() => {
        linkBridgeMocks.disableLink.mockReset();
    });

    it('delegates to the Link bridge and resolves with its result', async () => {
        linkBridgeMocks.disableLink.mockResolvedValue(undefined);

        await expect(disableLink()).resolves.toBeUndefined();

        expect(linkBridgeMocks.disableLink).toHaveBeenCalledTimes(1);
    });

    it('preserves Link bridge rejections', async () => {
        const error = new Error('link disable failed');
        linkBridgeMocks.disableLink.mockRejectedValue(error);

        await expect(disableLink()).rejects.toBe(error);

        expect(linkBridgeMocks.disableLink).toHaveBeenCalledTimes(1);
    });
});
