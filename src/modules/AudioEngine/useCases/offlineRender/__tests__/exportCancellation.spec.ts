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

    it.each(['agent-measurement', 'agent-section-render'] as const)(
        'lets only an agent render be preempted, and only once (%s)',
        async (holder) => {
            const { acquireRenderLock } = await import('../acquireRenderLock');
            const { canPreemptAgentRender } = await import('../canPreemptAgentRender');
            const { acquireRenderLockFromAgentRender } = await import('../acquireRenderLockFromAgentRender');
            const musician = acquireRenderLock('musician-export');
            expect(canPreemptAgentRender()).toBe(false);
            musician();

            const preempt = vi.fn();
            const agentRender = acquireRenderLock(holder, preempt);
            expect(canPreemptAgentRender()).toBe(true);
            const acquired = acquireRenderLockFromAgentRender();
            expect(preempt).toHaveBeenCalledTimes(1);
            expect(canPreemptAgentRender()).toBe(false);
            agentRender();
            const release = await acquired;
            release();
        }
    );

    it('refuses a section render as render busy while a measurement holds the lock, and the reverse', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { isRenderBusyError } = await import('../isRenderBusyError');
        const releaseMeasurement = acquireRenderLock('agent-measurement', () => undefined);
        expect(isRenderBusyError(thrownBy(() => acquireRenderLock('agent-section-render', () => undefined)))).toBe(
            true
        );
        releaseMeasurement();

        const releaseSection = acquireRenderLock('agent-section-render', () => undefined);
        expect(isRenderBusyError(thrownBy(() => acquireRenderLock('agent-measurement', () => undefined)))).toBe(true);
        releaseSection();
    });

    it('should throw from checkCancel after cancelExport while a musician export renders', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { checkCancel } = await import('../checkCancel');
        const { cancelExport } = await import('../exportCancellation');
        const { endExportCancellationScope } = await import('../endExportCancellationScope');
        const release = acquireRenderLock('musician-export');
        endExportCancellationScope();
        cancelExport();
        expect(() => checkCancel()).toThrow(/cancelled/);
        release();
    });

    it('should lower the cancel flag when the export scope closes', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { cancelExport } = await import('../exportCancellation');
        const { isCancelRequested } = await import('../isCancelRequested');
        const { endExportCancellationScope } = await import('../endExportCancellationScope');
        const release = acquireRenderLock('musician-export');
        cancelExport();
        expect(isCancelRequested()).toBe(true);
        endExportCancellationScope();
        expect(isCancelRequested()).toBe(false);
        release();
    });

    it('installs a fresh controller when the export scope closes', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { cancelExport } = await import('../exportCancellation');
        const { endExportCancellationScope } = await import('../endExportCancellationScope');
        const { beginExportCancellationScope } = await import('../beginExportCancellationScope');
        const { exportCancellationState } = await import('../exportCancellationState');
        const release = acquireRenderLock('musician-export');
        const staleScopeSignal = beginExportCancellationScope();
        cancelExport();
        expect(staleScopeSignal.aborted).toBe(true);

        endExportCancellationScope();

        // The signal state installs always belongs to the scope window that is
        // currently open, never the cancelled one.
        expect(exportCancellationState.controller.signal.aborted).toBe(false);
        release();
    });

    it.each(['agent-measurement', 'agent-section-render'] as const)(
        'leaves the cancel flag and scope untouched when an assistant render (%s) holds the lock',
        async (holder) => {
            const { acquireRenderLock } = await import('../acquireRenderLock');
            const { beginExportCancellationScope } = await import('../beginExportCancellationScope');
            const { checkCancel } = await import('../checkCancel');
            const { cancelExport } = await import('../exportCancellation');
            const { isCancelRequested } = await import('../isCancelRequested');
            const scopeSignal = beginExportCancellationScope();
            const release = acquireRenderLock(holder, () => undefined);

            cancelExport();

            expect(isCancelRequested()).toBe(false);
            expect(scopeSignal.aborted).toBe(false);
            expect(() => checkCancel()).not.toThrow();
            release();
        }
    );

    it('raises nothing when no render holds the lock, so no flag waits for a later render', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { checkCancel } = await import('../checkCancel');
        const { cancelExport } = await import('../exportCancellation');
        const { isCancelRequested } = await import('../isCancelRequested');

        cancelExport();

        expect(isCancelRequested()).toBe(false);
        const release = acquireRenderLock('agent-measurement', () => undefined);
        expect(() => checkCancel()).not.toThrow();
        release();
    });

    it('aborts a queued musician export without raising the flag an assistant render would read', async () => {
        const { acquireRenderLock } = await import('../acquireRenderLock');
        const { cancelExport } = await import('../exportCancellation');
        const { exportCancellationState } = await import('../exportCancellationState');
        const { isCancelRequested } = await import('../isCancelRequested');
        const release = acquireRenderLock('agent-section-render', () => undefined);
        const queued = new AbortController();
        exportCancellationState.queuedMusicianExport = queued;

        cancelExport();

        expect(queued.signal.aborted).toBe(true);
        expect(isCancelRequested()).toBe(false);
        release();
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
