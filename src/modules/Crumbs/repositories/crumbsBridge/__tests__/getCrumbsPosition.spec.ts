import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCrumbsPosition } from '../getCrumbsPosition';

const mocks = vi.hoisted(() => ({ desktop: vi.fn(), invoke: vi.fn() }));
vi.mock('#/utils/desktopBridge', () => ({ isDesktopRuntime: mocks.desktop, desktopInvoke: mocks.invoke }));

describe('getCrumbsPosition', () => {
    beforeEach(() => {
        mocks.desktop.mockReset().mockReturnValue(true);
        mocks.invoke.mockReset();
    });

    it.each([0n, 12345n, BigInt(Number.MAX_SAFE_INTEGER), 0, 12345, Number.MAX_SAFE_INTEGER])(
        'returns an exact numeric frame for %s',
        async (reply) => {
            mocks.invoke.mockResolvedValue(reply);
            await expect(getCrumbsPosition('device')).resolves.toBe(Number(reply));
            expect(mocks.invoke).toHaveBeenCalledWith('get_crumbs_position', { instanceId: 'device' });
        }
    );

    it.each([
        undefined,
        null,
        '123',
        {},
        -1n,
        BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        -1,
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
    ])('rejects an invalid frame reply %s', async (reply) => {
        mocks.invoke.mockResolvedValue(reply);
        await expect(getCrumbsPosition('device')).rejects.toThrow('Invalid Crumbs position');
    });

    it('propagates native errors', async () => {
        const error = new Error('native refused');
        mocks.invoke.mockRejectedValue(error);
        await expect(getCrumbsPosition('device')).rejects.toBe(error);
    });

    it('rejects without invoking native on the web', async () => {
        mocks.desktop.mockReturnValue(false);
        await expect(getCrumbsPosition('device')).rejects.toThrow('only available in the Sourdaw desktop app');
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});
