import { describe, expect, it, vi } from 'vitest';

import { createWindowCloseCoordinator } from '../windowCloseCoordinator.js';

describe('window close coordinator', () => {
    it('saves the requested close and only approves after the renderer confirms it is clean', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({
            ask: async () => 'save',
            send,
        });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        const approval = coordinator.requestClose();
        await Promise.resolve();
        expect(send).toHaveBeenCalledWith(1);
        coordinator.resolveSave({ requestId: 1, saved: true, dirty: false });

        await expect(approval).resolves.toBe(true);
        expect(coordinator.permitsClose()).toBe(true);
    });

    it('keeps the window open when saving fails or a later edit keeps the project dirty', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send: vi.fn() });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });
        const approval = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resolveSave({ requestId: 1, saved: false, dirty: true });

        await expect(approval).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(false);
    });

    it('rejects a successful save that reports the project still dirty and ignores a mismatched late result', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send: vi.fn() });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });
        const approval = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resolveSave({ requestId: 99, saved: true, dirty: false });
        coordinator.resolveSave({ requestId: 1, saved: true, dirty: true });

        await expect(approval).resolves.toBe(false);
    });

    it('settles an in-flight request when its renderer window is reset', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send: vi.fn() });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });
        const approval = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resetForWindow();

        await expect(approval).resolves.toBe(false);
    });

    it('does not open a second prompt while a save is in flight', async () => {
        let resolveDialog: ((answer: 'save' | 'discard' | 'cancel') => void) | undefined;
        const ask = vi.fn(
            () =>
                new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
                    resolveDialog = resolve;
                })
        );
        const coordinator = createWindowCloseCoordinator({ ask, send: vi.fn() });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        const first = coordinator.requestClose();
        const second = coordinator.requestClose();
        resolveDialog?.('cancel');

        await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('fails closed after a rejected prompt and allows a later close request', async () => {
        const ask = vi.fn().mockRejectedValueOnce(new Error('dialog failed')).mockResolvedValueOnce('discard');
        const coordinator = createWindowCloseCoordinator({ ask, send: vi.fn() });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        await expect(coordinator.requestClose()).resolves.toBe(false);
        await expect(coordinator.requestClose()).resolves.toBe(true);

        expect(ask).toHaveBeenCalledTimes(2);
        expect(coordinator.permitsClose()).toBe(true);
    });

    it('fails closed after save dispatch throws and allows a later retry', async () => {
        let coordinator: ReturnType<typeof createWindowCloseCoordinator>;
        const send = vi.fn((requestId: number) => {
            if (requestId === 1) {
                throw new Error('renderer unavailable');
            }
            coordinator.resolveSave({ requestId, saved: true, dirty: false });
        });
        coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        await expect(coordinator.requestClose()).resolves.toBe(false);
        await expect(coordinator.requestClose()).resolves.toBe(true);

        expect(send).toHaveBeenCalledTimes(2);
        expect(coordinator.permitsClose()).toBe(true);
    });
});
