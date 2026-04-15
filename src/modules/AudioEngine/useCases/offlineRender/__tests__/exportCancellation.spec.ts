import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('exportCancellation', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should throw when acquiring a second render lock without releasing the first', async () => {
        const { acquireRenderLock } = await import('../exportCancellation');
        const release = acquireRenderLock();
        expect(() => acquireRenderLock()).toThrow(/already in progress/);
        release();
    });

    it('should allow a new lock after the previous release', async () => {
        const { acquireRenderLock } = await import('../exportCancellation');
        const release = acquireRenderLock();
        release();
        const release2 = acquireRenderLock();
        expect(release2).toBeTypeOf('function');
        release2();
    });

    it('should throw from checkCancel after cancelExport', async () => {
        const { cancelExport, checkCancel, resetCancelFlag } = await import('../exportCancellation');
        resetCancelFlag();
        cancelExport();
        expect(() => checkCancel()).toThrow(/cancelled/);
    });

    it('should reset cancel flag', async () => {
        const { cancelExport, resetCancelFlag, isCancelRequested } = await import('../exportCancellation');
        cancelExport();
        expect(isCancelRequested()).toBe(true);
        resetCancelFlag();
        expect(isCancelRequested()).toBe(false);
    });
});
