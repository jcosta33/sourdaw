import { describe, it, expect, vi, afterEach } from 'vitest';

import { isDragGestureActive } from '#/utils/UI/activeDragGesture';

import { startMouseDrag } from '../mouseDrag';

describe('startMouseDrag', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should attach move and up listeners then remove them after mouseup', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const onMove = vi.fn();
        const onUp = vi.fn();

        startMouseDrag(onMove, onUp);

        expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

        const upHandler = addSpy.mock.calls.find((context) => String(context[0]) === 'mouseup')?.[1] as (
            e: MouseEvent
        ) => void;
        expect(upHandler).toBeDefined();

        window.dispatchEvent(new MouseEvent('mousemove'));
        expect(onMove).toHaveBeenCalledTimes(1);

        upHandler(new MouseEvent('mouseup'));
        expect(onUp).toHaveBeenCalledTimes(1);
        expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));

        window.dispatchEvent(new MouseEvent('mousemove'));
        expect(onMove).toHaveBeenCalledTimes(1);
    });

    it('cancels on Escape without calling onUp, and stops forwarding further moves', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();

        startMouseDrag(onMove, onUp);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(onUp).not.toHaveBeenCalled();

        window.dispatchEvent(new MouseEvent('mousemove'));
        window.dispatchEvent(new MouseEvent('mouseup'));

        expect(onMove).not.toHaveBeenCalled();
        expect(onUp).not.toHaveBeenCalled();
    });

    it('calls onCancel instead of onUp on Escape, so a caller can revert a live mutation', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();
        const onCancel = vi.fn();

        startMouseDrag(onMove, onUp, onCancel);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onUp).not.toHaveBeenCalled();
    });

    it('the returned cancel handle runs onCancel too, not just listener removal', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();
        const onCancel = vi.fn();

        const cancel = startMouseDrag(onMove, onUp, onCancel);
        cancel();

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onUp).not.toHaveBeenCalled();
    });

    it('never calls onCancel after a real mouseup already committed, even if Escape races in after', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();
        const onCancel = vi.fn();

        startMouseDrag(onMove, onUp, onCancel);
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onUp).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(onCancel).not.toHaveBeenCalled();
    });

    it('is safe to omit onCancel — Escape still tears down listeners without throwing', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();

        startMouseDrag(onMove, onUp);

        expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
    });

    it('ignores a non-Escape key so an ordinary keystroke does not cancel the drag', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();

        startMouseDrag(onMove, onUp);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

        window.dispatchEvent(new MouseEvent('mousemove'));
        expect(onMove).toHaveBeenCalledTimes(1);
    });

    it('ignores the auto-repeat of an Escape held down since before the drag began', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();
        const onCancel = vi.fn();

        startMouseDrag(onMove, onUp, onCancel);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true }));

        expect(onCancel).not.toHaveBeenCalled();
        expect(isDragGestureActive()).toBe(true);

        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onUp).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it.each([['shiftKey'], ['ctrlKey'], ['altKey'], ['metaKey']] as const)(
        'ignores Escape pressed with %s so a modified chord does not abort the drag',
        (modifier) => {
            const onUp = vi.fn();
            const onCancel = vi.fn();

            startMouseDrag(vi.fn(), onUp, onCancel);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', [modifier]: true }));

            expect(onCancel).not.toHaveBeenCalled();
            expect(isDragGestureActive()).toBe(true);

            window.dispatchEvent(new MouseEvent('mouseup'));
            expect(onUp).toHaveBeenCalledTimes(1);
        }
    );

    it('returns a teardown that is idempotent and callable before any release', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const cancel = startMouseDrag(onMove, onUp);
        cancel();
        cancel();

        // One removal per listener type despite two `cancel()` calls.
        expect(removeSpy.mock.calls.filter((call) => (call[0] as string) === 'mousemove')).toHaveLength(1);
        expect(removeSpy.mock.calls.filter((call) => (call[0] as string) === 'mouseup')).toHaveLength(1);
        expect(removeSpy.mock.calls.filter((call) => (call[0] as string) === 'keydown')).toHaveLength(1);
        expect(removeSpy.mock.calls.filter((call) => (call[0] as string) === 'blur')).toHaveLength(1);

        window.dispatchEvent(new MouseEvent('mousemove'));
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onMove).not.toHaveBeenCalled();
        expect(onUp).not.toHaveBeenCalled();
    });

    it('does not double-fire onUp when the caller cancels after a real mouseup already tore down', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();

        const cancel = startMouseDrag(onMove, onUp);
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(onUp).toHaveBeenCalledTimes(1);

        cancel();

        expect(onUp).toHaveBeenCalledTimes(1);
    });

    describe('losing window focus', () => {
        it('commits through onUp once, at the last move, when the button is released in another app', () => {
            const onMove = vi.fn();
            const onUp = vi.fn();
            const onCancel = vi.fn();

            startMouseDrag(onMove, onUp, onCancel);
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 12 }));
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 64 }));

            window.dispatchEvent(new Event('blur'));

            expect(onUp).toHaveBeenCalledTimes(1);
            expect(onUp.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ clientX: 140, clientY: 64 }));
            expect(onCancel).not.toHaveBeenCalled();
        });

        it('cancels when the pointer never moved, so a bare press commits nothing', () => {
            const onUp = vi.fn();
            const onCancel = vi.fn();

            startMouseDrag(vi.fn(), onUp, onCancel);
            window.dispatchEvent(new Event('blur'));

            expect(onCancel).toHaveBeenCalledTimes(1);
            expect(onUp).not.toHaveBeenCalled();
        });

        it('clears the drag mark and ignores the moves, mouseup and Escape that arrive after it', () => {
            const onMove = vi.fn();
            const onUp = vi.fn();
            const onCancel = vi.fn();

            startMouseDrag(onMove, onUp, onCancel);
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 12 }));
            window.dispatchEvent(new Event('blur'));

            expect(isDragGestureActive()).toBe(false);

            // Back in the window with the button already up: nothing may still follow the pointer.
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 90 }));
            window.dispatchEvent(new MouseEvent('mouseup', { clientX: 300, clientY: 90 }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

            expect(onMove).toHaveBeenCalledTimes(1);
            expect(onUp).toHaveBeenCalledTimes(1);
            expect(onCancel).not.toHaveBeenCalled();
        });
    });

    describe('active drag marker', () => {
        it('is active from start until mouseup', () => {
            startMouseDrag(vi.fn(), vi.fn());
            expect(isDragGestureActive()).toBe(true);
            window.dispatchEvent(new MouseEvent('mouseup'));
            expect(isDragGestureActive()).toBe(false);
        });

        it('is cleared by Escape cancel and by a caller-initiated cancel', () => {
            startMouseDrag(vi.fn(), vi.fn());
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(isDragGestureActive()).toBe(false);

            const cancel = startMouseDrag(vi.fn(), vi.fn());
            expect(isDragGestureActive()).toBe(true);
            cancel();
            expect(isDragGestureActive()).toBe(false);
        });
    });
});
