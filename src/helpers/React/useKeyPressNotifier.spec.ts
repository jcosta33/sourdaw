/* (c) Copyright Frontify Ltd., all rights reserved. */

import { fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyPressNotifier } from './useKeyPressNotifier';

describe(useKeyPressNotifier.name, () => {
    const mockListener = vi.fn();

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('fires keydown event and unmounts key notifier', () => {
        const { unmount } = renderHook(() => useKeyPressNotifier('Meta+K', mockListener));

        fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
        unmount();
        fireEvent.keyDown(document, { key: 'K', ctrlKey: true });

        expect(mockListener).toHaveBeenCalledOnce();
    });

    it('should fire the listener thrice if the hook is used multiple times with same keys', () => {
        const mockListener1 = vi.fn();
        const mockListener2 = vi.fn();
        const mockListener3 = vi.fn();

        renderHook(() => useKeyPressNotifier('Meta+K', mockListener1));
        renderHook(() => useKeyPressNotifier('Meta+K', mockListener2));
        renderHook(() => useKeyPressNotifier('Meta+K', mockListener3));

        fireEvent.keyDown(document, { key: 'K', ctrlKey: true });

        expect(mockListener1).toHaveBeenCalledOnce();
        expect(mockListener2).toHaveBeenCalledOnce();
        expect(mockListener3).toHaveBeenCalledOnce();
    });

    it('should not fire the listener twice if the hook is used multiple times with different keys', () => {
        const mockListener1 = vi.fn();
        const mockListener2 = vi.fn();
        const mockListener3 = vi.fn();

        renderHook(() => useKeyPressNotifier('Meta+X', mockListener1));
        renderHook(() => useKeyPressNotifier('Meta+Y', mockListener2));
        renderHook(() => useKeyPressNotifier('Meta+Z', mockListener3));

        fireEvent.keyDown(document, { key: 'X', ctrlKey: true });
        fireEvent.keyDown(document, { key: 'Y', ctrlKey: true });
        fireEvent.keyDown(document, { key: 'Z', ctrlKey: true });

        expect(mockListener1).toHaveBeenCalledOnce();
        expect(mockListener2).toHaveBeenCalledOnce();
        expect(mockListener3).toHaveBeenCalledOnce();
    });
});
