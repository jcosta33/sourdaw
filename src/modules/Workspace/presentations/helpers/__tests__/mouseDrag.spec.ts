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

        const upHandler = addSpy.mock.calls.find((c) => c[0] === 'mouseup')?.[1] as (e: MouseEvent) => void;
        expect(upHandler).toBeDefined();

        window.dispatchEvent(new MouseEvent('mousemove'));
        expect(onMove).toHaveBeenCalledTimes(1);

        upHandler!(new MouseEvent('mouseup'));
        expect(onUp).toHaveBeenCalledTimes(1);
        expect(removeSpy).toHaveBeenCalledWith('mousemove', onMove);
    });
});
