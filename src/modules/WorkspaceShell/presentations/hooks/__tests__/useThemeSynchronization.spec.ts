import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useThemeSynchronization } from '../useThemeSynchronization';

const mocks = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
    preferences: { current: { theme: 'light' } },
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

describe('useThemeSynchronization', () => {
    beforeEach(() => {
        mocks.listeners.clear();
        mocks.preferences.current = { theme: 'light' };
        document.documentElement.classList.remove('dark', 'light');
    });

    it('applies the stored theme after mount and follows preference changes until cleanup', () => {
        const { unmount } = renderHook(() => useThemeSynchronization());

        expect(document.documentElement).toHaveClass('light');
        expect(document.documentElement).not.toHaveClass('dark');

        mocks.preferences.current = { theme: 'dark' };
        act(() => {
            for (const listener of mocks.listeners) {
                listener();
            }
        });

        expect(document.documentElement).toHaveClass('dark');
        expect(document.documentElement).not.toHaveClass('light');
        unmount();
        expect(mocks.listeners.size).toBe(0);
    });
});
