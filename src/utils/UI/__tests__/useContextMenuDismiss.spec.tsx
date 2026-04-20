import { createRef } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useContextMenuDismiss } from '../useContextMenuDismiss';

describe('useContextMenuDismiss', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('should call onClose when Escape is pressed', () => {
        const onClose = vi.fn();
        const ref = createRef<HTMLDivElement>();
        const menu = document.createElement('div');
        document.body.append(menu);
        ref.current = menu;

        const { unmount } = renderHook(() => useContextMenuDismiss(ref, onClose));

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(onClose).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('should call onClose when mousedown happens outside the menu element', () => {
        const onClose = vi.fn();
        const ref = createRef<HTMLDivElement>();
        const menu = document.createElement('div');
        const outside = document.createElement('button');
        document.body.append(menu, outside);
        ref.current = menu;

        const { unmount } = renderHook(() => useContextMenuDismiss(ref, onClose));

        const ev = new MouseEvent('mousedown', { bubbles: true });
        Object.defineProperty(ev, 'target', { value: outside, enumerable: true });
        document.dispatchEvent(ev);

        expect(onClose).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('should not call onClose when mousedown target is inside the menu', () => {
        const onClose = vi.fn();
        const ref = createRef<HTMLDivElement>();
        const menu = document.createElement('div');
        const inner = document.createElement('span');
        menu.append(inner);
        document.body.append(menu);
        ref.current = menu;

        const { unmount } = renderHook(() => useContextMenuDismiss(ref, onClose));

        const ev = new MouseEvent('mousedown', { bubbles: true });
        Object.defineProperty(ev, 'target', { value: inner, enumerable: true });
        document.dispatchEvent(ev);

        expect(onClose).not.toHaveBeenCalled();
        unmount();
    });
});
