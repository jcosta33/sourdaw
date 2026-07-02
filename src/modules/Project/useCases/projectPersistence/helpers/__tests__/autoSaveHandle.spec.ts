import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('autoSaveHandle', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should invoke and clear the handle when stopping active auto-save', async () => {
        const { setAutoSaveHandle } = await import('../autoSaveHandle');
        const { stopActiveAutoSave } = await import('../stopActiveAutoSave');
        const fn = vi.fn();
        setAutoSaveHandle(fn);
        stopActiveAutoSave();
        expect(fn).toHaveBeenCalledTimes(1);

        const { stopActiveAutoSave: stop2 } = await import('../stopActiveAutoSave');
        stop2();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should tolerate stop when no handle is set', async () => {
        const { stopActiveAutoSave } = await import('../stopActiveAutoSave');
        expect(() => stopActiveAutoSave()).not.toThrow();
    });
});
