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
    getLinkStatus: vi.fn<() => Promise<LinkStatus>>(),
}));

vi.mock('../../../repositories/linkBridge/getLinkStatus', () => ({
    getLinkStatus: linkBridgeMocks.getLinkStatus,
}));

import { getLinkStatus } from '../getLinkStatus';

describe('getLinkStatus', () => {
    beforeEach(() => {
        linkBridgeMocks.getLinkStatus.mockReset();
    });

    it('delegates to the Link bridge and returns its status', async () => {
        const status: LinkStatus = {
            supported: false,
            implementation: 'unsupported',
            enabled: false,
            tempo: 120,
            quantum: 4,
            beat: 0,
            phase: 0,
            num_peers: 0,
            message: 'Ableton Link is unavailable',
        };
        linkBridgeMocks.getLinkStatus.mockResolvedValue(status);

        await expect(getLinkStatus()).resolves.toEqual(status);

        expect(linkBridgeMocks.getLinkStatus).toHaveBeenCalledTimes(1);
    });

    it('preserves Link bridge rejections', async () => {
        const error = new Error('link status failed');
        linkBridgeMocks.getLinkStatus.mockRejectedValue(error);

        await expect(getLinkStatus()).rejects.toBe(error);

        expect(linkBridgeMocks.getLinkStatus).toHaveBeenCalledTimes(1);
    });
});
