import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('exportCancellation', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should throw when acquiring a second render lock without releasing the first', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const release = acquireRenderLock();
        expect(() => acquireRenderLock()).toThrow(/already in progress/);
        release();
    });

    it('should allow a new lock after the previous release', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const release = acquireRenderLock();
        release();
        const release2 = acquireRenderLock();
        expect(release2).toBeTypeOf('function');
        release2();
    });

    it('should expose active state across split lock helpers', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { isExportActive } = await import('../isExportActive');
        expect(isExportActive()).toBe(false);
        const release = acquireRenderLock();
        expect(isExportActive()).toBe(true);
        release();
        expect(isExportActive()).toBe(false);
    });

    it('should throw from checkCancel after cancelExport', async () => {
        const { checkCancel } = await import('../checkCancel');
        const { cancelExport } = await import('../exportCancellation');
        const { resetCancelFlag } = await import('../resetCancelFlag');
        resetCancelFlag();
        cancelExport();
        expect(() => checkCancel()).toThrow(/cancelled/);
    });

    it('should reset cancel flag', async () => {
        const { cancelExport } = await import('../exportCancellation');
        const { isCancelRequested } = await import('../isCancelRequested');
        const { resetCancelFlag } = await import('../resetCancelFlag');
        cancelExport();
        expect(isCancelRequested()).toBe(true);
        resetCancelFlag();
        expect(isCancelRequested()).toBe(false);
    });

    it('should create fresh cancellation state after module reset', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { cancelExport } = await import('../exportCancellation');
        const { isCancelRequested } = await import('../isCancelRequested');
        const { isExportActive } = await import('../isExportActive');
        acquireRenderLock();
        cancelExport();
        expect(isCancelRequested()).toBe(true);
        expect(isExportActive()).toBe(true);

        vi.resetModules();

        const { isCancelRequested: isCancelRequestedAfterReset } = await import('../isCancelRequested');
        const { isExportActive: isExportActiveAfterReset } = await import('../isExportActive');
        expect(isCancelRequestedAfterReset()).toBe(false);
        expect(isExportActiveAfterReset()).toBe(false);
    });
});
