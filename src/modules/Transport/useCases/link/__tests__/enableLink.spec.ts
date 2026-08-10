import { beforeEach, describe, expect, it, vi } from 'vitest';

type LinkStatus = {
    supported: boolean;
    implementation: string;
    enabled: boolean;
    tempo: number;
    quantum: number;
    beat: number;
    phase: number;
    num_peers: number;
    message: string | null;
};

const linkBridgeMocks = vi.hoisted(() => ({
    enableLink: vi.fn<() => Promise<LinkStatus>>(),
}));

vi.mock('../../../repositories/linkBridge/enableLink', () => ({
    enableLink: linkBridgeMocks.enableLink,
}));

import { enableLink } from '../enableLink';

describe('enableLink', () => {
    beforeEach(() => {
        linkBridgeMocks.enableLink.mockReset();
    });

    it('delegates to the Link bridge and returns its status', async () => {
        const status: LinkStatus = {
            supported: true,
            implementation: 'native',
            enabled: true,
            tempo: 128,
            quantum: 4,
            beat: 16,
            phase: 0.25,
            num_peers: 2,
            message: null,
        };
        linkBridgeMocks.enableLink.mockResolvedValue(status);

        await expect(enableLink()).resolves.toEqual(status);

        expect(linkBridgeMocks.enableLink).toHaveBeenCalledTimes(1);
    });

    it('preserves Link bridge rejections', async () => {
        const error = new Error('link enable failed');
        linkBridgeMocks.enableLink.mockRejectedValue(error);

        await expect(enableLink()).rejects.toBe(error);

        expect(linkBridgeMocks.enableLink).toHaveBeenCalledTimes(1);
    });
});
