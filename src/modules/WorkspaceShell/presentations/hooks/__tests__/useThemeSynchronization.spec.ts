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
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
        mocks.listeners.clear();
        mocks.preferences.current = { theme: 'light' };
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.style.colorScheme = '';
        document.head.innerHTML = '<meta name="theme-color" content="#020100" />';
    });

    it('applies every browser theme channel after mount and follows preference changes until cleanup', () => {
        const { unmount } = renderHook(() => useThemeSynchronization());

        expect(document.documentElement).toHaveClass('light');
        expect(document.documentElement).not.toHaveClass('dark');
        expect(document.documentElement.style.colorScheme).toBe('light');
        expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#ded8cf');

        mocks.preferences.current = { theme: 'dark' };
        act(() => {
            for (const listener of mocks.listeners) {
                listener();
            }
        });

        expect(document.documentElement).toHaveClass('dark');
        expect(document.documentElement).not.toHaveClass('light');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#020100');
        unmount();
        expect(mocks.listeners.size).toBe(0);
    });
    it('follows system changes only while system is selected and unsubscribes on unmount', () => {
        let dark = false;
        const listeners = new Set<() => void>();
        vi.stubGlobal('matchMedia', () => ({
            get matches() {
                return dark;
            },
            addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
        }));
        mocks.preferences.current = { theme: 'system' };
        const { unmount } = renderHook(() => useThemeSynchronization());
        expect(document.documentElement).toHaveClass('light');
        dark = true;
        act(() => {
            for (const listener of listeners) {
                listener();
            }
        });
        expect(document.documentElement).toHaveClass('dark');
        mocks.preferences.current = { theme: 'light' };
        act(() => {
            for (const listener of mocks.listeners) {
                listener();
            }
        });
        act(() => {
            for (const listener of listeners) {
                listener();
            }
        });
        expect(document.documentElement).toHaveClass('light');
        unmount();
        expect(listeners.size).toBe(0);
        vi.unstubAllGlobals();
    });
});
