import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('autoSaveHandle', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should invoke and clear the handle when stopping active auto-save', async () => {
        const { setAutoSaveHandle, stopActiveAutoSave } = await import('../autoSaveHandle');
        const fn = vi.fn();
        setAutoSaveHandle(fn);
        stopActiveAutoSave();
        expect(fn).toHaveBeenCalledTimes(1);

        const { stopActiveAutoSave: stop2 } = await import('../autoSaveHandle');
        stop2();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should tolerate stop when no handle is set', async () => {
        const { stopActiveAutoSave } = await import('../autoSaveHandle');
        expect(() => stopActiveAutoSave()).not.toThrow();
    });
});
