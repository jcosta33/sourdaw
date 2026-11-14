import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppActionConflictError } from '#/modules/Command/errors/AppActionExecutionError';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<(action: unknown, options?: unknown) => Promise<void>>(),
    notifyUser: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/modules/Command/useCases/executeAppAction', () => ({ executeAppAction: mocks.executeAppAction }));

import { crumbsStore, ensureInstance, setMode } from '../../stores/crumbsStore';
import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';

const DEVICE_ID = 'crumbs-1';

describe('initCrumbsDeviceStatePersistence on a refused project', () => {
    let stop: () => void;
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
        unhandled.push(reason);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        unhandled.length = 0;
        process.on('unhandledRejection', record);
        mocks.executeAppAction.mockRejectedValue(new AppActionConflictError('setDeviceState'));
        crumbsStore.set({});
        stop = initCrumbsDeviceStatePersistence();
        ensureInstance(DEVICE_ID);
    });

    afterEach(() => {
        process.off('unhandledRejection', record);
        stop();
        crumbsStore.set({});
    });

    it('tells the user once for a sweep of mode switches and leaves no unhandled rejection', async () => {
        const modes = ['drum', 'slice', 'warp', 'drum', 'slice'] as const;
        for (const mode of modes) {
            setMode(DEVICE_ID, mode);
        }
        await vi.waitFor(() => expect(mocks.notifyUser).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(modes.length);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser.mock.calls[0]?.[1]).toBe('warning');
        expect(unhandled).toEqual([]);
    });
});
