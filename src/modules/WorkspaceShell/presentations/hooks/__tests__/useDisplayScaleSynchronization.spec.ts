import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDisplayScale } from '../../../useCases/applyDisplayScale';
import { useDisplayScaleSynchronization } from '../useDisplayScaleSynchronization';

const mocks = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
    preferences: { current: { uiScale: 2 } },
}));

vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: {
        get value() {
            return mocks.preferences.current;
        },
        subscribe(listener: () => void) {
            mocks.listeners.add(listener);
            return () => {
                mocks.listeners.delete(listener);
            };
        },
    },
}));

vi.mock('../../../useCases/applyDisplayScale', () => ({ applyDisplayScale: vi.fn() }));

describe('useDisplayScaleSynchronization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listeners.clear();
        mocks.preferences.current = { uiScale: 2 };
    });

    it('reapplies the stored scale after mount and follows preference changes until cleanup', () => {
        const { unmount } = renderHook(() => useDisplayScaleSynchronization());

        expect(applyDisplayScale).toHaveBeenCalledWith(2);

        mocks.preferences.current = { uiScale: 1.25 };
        act(() => {
            for (const listener of mocks.listeners) {
                listener();
            }
        });

        expect(applyDisplayScale).toHaveBeenLastCalledWith(1.25);
        unmount();

        vi.mocked(applyDisplayScale).mockClear();
        act(() => {
            for (const listener of mocks.listeners) {
                listener();
            }
        });
        expect(applyDisplayScale).not.toHaveBeenCalled();
    });
});
