import { describe, it, expect, beforeEach, vi } from 'vitest';

function thrownBy(action: () => unknown): unknown {
    try {
        action();
    } catch (error) {
        return error;
    }
    throw new Error('expected the action to throw');
}

describe('exportCancellation', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('should throw when acquiring a second render lock without releasing the first', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const release = acquireRenderLock('musician-export');
        expect(() => acquireRenderLock('musician-export')).toThrow(/already in progress/);
        release();
    });

    it('should allow a new lock after the previous release', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const release = acquireRenderLock('musician-export');
        release();
        const release2 = acquireRenderLock('musician-export');
        expect(release2).toBeTypeOf('function');
        release2();
    });

    it('should expose active state across split lock helpers', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { isExportActive } = await import('../isExportActive');
        expect(isExportActive()).toBe(false);
        const release = acquireRenderLock('musician-export');
        expect(isExportActive()).toBe(true);
        release();
        expect(isExportActive()).toBe(false);
    });

    it('names the holder: a measurement leaves isExportActive false, a musician export sets it', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { isExportActive } = await import('../isExportActive');
        const releaseMeasurement = acquireRenderLock('agent-measurement', () => undefined);
        expect(isExportActive()).toBe(false);
        releaseMeasurement();
        const releaseMusician = acquireRenderLock('musician-export');
        expect(isExportActive()).toBe(true);
        releaseMusician();
    });

    it("refuses a measurement as render busy and a musician export with today's message while a render holds the lock", async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { isRenderBusyError } = await import('../isRenderBusyError');
        const release = acquireRenderLock('musician-export');
        expect(isRenderBusyError(thrownBy(() => acquireRenderLock('agent-measurement', () => undefined)))).toBe(true);
        expect(thrownBy(() => acquireRenderLock('musician-export'))).toMatchObject({
            _tag: 'Export',
            message: 'An export is already in progress. Cancel the current export before starting a new one.',
        });
        release();
    });

    it('refuses every acquire while a musician export is queued for the lock', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { exportCancellationState } = await import('../exportCancellationState');
        const { isRenderBusyError } = await import('../isRenderBusyError');
        exportCancellationState.queuedMusicianExport = new AbortController();
        expect(isRenderBusyError(thrownBy(() => acquireRenderLock('agent-measurement', () => undefined)))).toBe(true);
        expect(thrownBy(() => acquireRenderLock('musician-export'))).toMatchObject({ _tag: 'Export' });
    });

    it('lets only a measurement be preempted, and only once', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { canPreemptMeasurement } = await import('../canPreemptMeasurement');
        const { acquireRenderLockFromMeasurement } = await import('../acquireRenderLockFromMeasurement');
        const musician = acquireRenderLock('musician-export');
        expect(canPreemptMeasurement()).toBe(false);
        musician();

        const preempt = vi.fn();
        const measurement = acquireRenderLock('agent-measurement', preempt);
        expect(canPreemptMeasurement()).toBe(true);
        const acquired = acquireRenderLockFromMeasurement();
        expect(preempt).toHaveBeenCalledTimes(1);
        expect(canPreemptMeasurement()).toBe(false);
        measurement();
        const release = await acquired;
        release();
    });

    it('should throw from checkCancel after cancelExport', async () => {
        const { checkCancel } = await import('../checkCancel');
        const { cancelExport } = await import('../exportCancellation');
        const { endExportCancellationScope } = await import('../endExportCancellationScope');
        endExportCancellationScope();
        cancelExport();
        expect(() => checkCancel()).toThrow(/cancelled/);
    });

    it('should lower the cancel flag when the export scope closes', async () => {
        const { cancelExport } = await import('../exportCancellation');
        const { isCancelRequested } = await import('../isCancelRequested');
        const { endExportCancellationScope } = await import('../endExportCancellationScope');
        cancelExport();
        expect(isCancelRequested()).toBe(true);
        endExportCancellationScope();
        expect(isCancelRequested()).toBe(false);
    });

    it('installs a fresh controller when the export scope closes', async () => {
        const { cancelExport } = await import('../exportCancellation');
        const { endExportCancellationScope } = await import('../endExportCancellationScope');
        const { beginExportCancellationScope } = await import('../beginExportCancellationScope');
        const { exportCancellationState } = await import('../exportCancellationState');
        const staleScopeSignal = beginExportCancellationScope();
        cancelExport();
        expect(staleScopeSignal.aborted).toBe(true);

        endExportCancellationScope();

        // The signal state installs always belongs to the scope window that is
        // currently open, never the cancelled one.
        expect(exportCancellationState.controller.signal.aborted).toBe(false);
    });

    it('should create fresh cancellation state after module reset', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { cancelExport } = await import('../exportCancellation');
        const { isCancelRequested } = await import('../isCancelRequested');
        const { isExportActive } = await import('../isExportActive');
        acquireRenderLock('musician-export');
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
