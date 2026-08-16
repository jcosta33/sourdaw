import { describe, it, expect, vi, afterEach } from 'vitest';

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

        expect(addSpy).toHaveBeenCalledWith('mousemove', onMove);
        expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

        const upHandler = addSpy.mock.calls.find((context) => String(context[0]) === 'mouseup')?.[1] as (
            e: MouseEvent
        ) => void;
        expect(upHandler).toBeDefined();

        window.dispatchEvent(new MouseEvent('mousemove'));
        expect(onMove).toHaveBeenCalledTimes(1);

        upHandler(new MouseEvent('mouseup'));
        expect(onUp).toHaveBeenCalledTimes(1);
        expect(removeSpy).toHaveBeenCalledWith('mousemove', onMove);
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

    it('ignores a non-Escape key so an ordinary keystroke does not cancel the drag', () => {
        const onMove = vi.fn();
        const onUp = vi.fn();

        startMouseDrag(onMove, onUp);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

        window.dispatchEvent(new MouseEvent('mousemove'));
        expect(onMove).toHaveBeenCalledTimes(1);
    });

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
});
