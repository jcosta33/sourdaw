import { describe, expect, it, vi } from 'vitest';

import { subscribeToGrandBouleRuntime } from '../../stores/grandBouleRuntimeNotifications';

const mocks = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { initGrandBouleSubscribers } from '../grandBouleSubscriber';

describe('initGrandBouleSubscribers', () => {
    it('hydrates a ready live node without mounting the panel', () => {
        mocks.reconcile.mockClear();
        let loaded: ((payload: { deviceId: string; deviceType: string }) => void) | undefined;
        const unsubscribe = vi.fn();
        const eventBus = {
            on: vi.fn((_event: 'audioDevice.loaded', handler: typeof loaded) => {
                loaded = handler;
                return unsubscribe;
            }),
        };

        const stop = initGrandBouleSubscribers({ eventBus, logger: { info: vi.fn() } });
        const notify = vi.fn(() => expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('grand-1'));
        const unsubscribeRuntime = subscribeToGrandBouleRuntime('grand-1', notify);
        loaded?.({ deviceId: 'grand-1', deviceType: 'grand-boule' });

        expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('grand-1');
        expect(notify).toHaveBeenCalledOnce();
        unsubscribeRuntime();
        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('notifies the addressed panel even when hydration throws', () => {
        let loaded: ((payload: { deviceId: string; deviceType: string }) => void) | undefined;
        const eventBus = {
            on: vi.fn((_event: 'audioDevice.loaded', handler: typeof loaded) => {
                loaded = handler;
                return vi.fn();
            }),
        };
        const notify = vi.fn();
        const other = vi.fn();
        const unsubscribe = subscribeToGrandBouleRuntime('grand-1', notify);
        const unsubscribeOther = subscribeToGrandBouleRuntime('grand-2', other);
        const stop = initGrandBouleSubscribers({ eventBus, logger: { info: vi.fn() } });
        mocks.reconcile.mockImplementationOnce(() => {
            throw new Error('hydration failed');
        });

        expect(() => loaded?.({ deviceId: 'grand-1', deviceType: 'grand-boule' })).toThrow('hydration failed');
        expect(notify).toHaveBeenCalledOnce();
        expect(other).not.toHaveBeenCalled();
        unsubscribe();
        unsubscribeOther();
        stop();
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
