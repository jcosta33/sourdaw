import { beforeEach, describe, expect, it, vi } from 'vitest';

import { crumbsNoteOff } from '../crumbsNoteOff';
import { crumbsNoteOn } from '../crumbsNoteOn';

const mocks = vi.hoisted(() => ({ desktop: vi.fn(), invoke: vi.fn() }));
vi.mock('#/utils/desktopBridge', () => ({ isDesktopRuntime: mocks.desktop, desktopInvoke: mocks.invoke }));

describe('Crumbs pad audition bridge', () => {
    beforeEach(() => {
        mocks.desktop.mockReset();
        mocks.invoke.mockReset();
    });

    it('sends the acquisition and release with their exact arguments', async () => {
        mocks.desktop.mockReturnValue(true);
        mocks.invoke.mockResolvedValueOnce(42).mockResolvedValueOnce(undefined);
        await expect(crumbsNoteOn('device', 63, 90)).resolves.toBe(42);
        await crumbsNoteOff('device', 42);
        expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'crumbs_pad_audition_on', {
            instanceId: 'device',
            note: 63,
            velocity: 90,
        });
        expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'crumbs_pad_audition_off', {
            instanceId: 'device',
            auditionId: 42,
        });
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });

    it.each([undefined, null, '42', 0, -1, 1.5, Number.NaN, 0x1_0000_0000])(
        'rejects invalid receipt %s',
        async (receipt) => {
            mocks.desktop.mockReturnValue(true);
            mocks.invoke.mockResolvedValue(receipt);
            await expect(crumbsNoteOn('device', 63, 90)).rejects.toThrow('Invalid Crumbs audition receipt');
        }
    );

    it('propagates native refusals', async () => {
        mocks.desktop.mockReturnValue(true);
        const error = new Error('native refused');
        mocks.invoke.mockRejectedValue(error);
        await expect(crumbsNoteOn('device', 63, 90)).rejects.toBe(error);
        await expect(crumbsNoteOff('device', 42)).rejects.toBe(error);
    });

    it('does not invoke native commands on the web', async () => {
        mocks.desktop.mockReturnValue(false);
        await expect(crumbsNoteOn('device', 63, 90)).resolves.toBeUndefined();
        await expect(crumbsNoteOff('device', 42)).resolves.toBeUndefined();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});
