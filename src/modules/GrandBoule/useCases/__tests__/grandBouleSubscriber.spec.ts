import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { initGrandBouleSubscribers } from '../grandBouleSubscriber';

describe('initGrandBouleSubscribers', () => {
    it('hydrates a ready live node without mounting the panel', () => {
        let loaded: ((payload: { deviceId: string; deviceType: string }) => void) | undefined;
        const unsubscribe = vi.fn();
        const eventBus = {
            on: vi.fn((_event: 'audioDevice.loaded', handler: typeof loaded) => {
                loaded = handler;
                return unsubscribe;
            }),
        };

        const stop = initGrandBouleSubscribers({ eventBus, logger: { info: vi.fn() } });
        loaded?.({ deviceId: 'grand-1', deviceType: 'grand-boule' });

        expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('grand-1');
        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('ignores other device families', () => {
        mocks.reconcile.mockClear();
        let loaded: ((payload: { deviceId: string; deviceType: string }) => void) | undefined;
        const eventBus = {
            on: vi.fn((_event: 'audioDevice.loaded', handler: typeof loaded) => {
                loaded = handler;
                return vi.fn();
            }),
        };

        initGrandBouleSubscribers({ eventBus, logger: { info: vi.fn() } });
        loaded?.({ deviceId: 'toaster-1', deviceType: 'toaster' });

        expect(mocks.reconcile).not.toHaveBeenCalled();
    });
});
