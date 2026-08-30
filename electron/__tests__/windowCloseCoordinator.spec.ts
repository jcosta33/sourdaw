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
        expect(send).toHaveBeenCalledWith('save', 1, expect.objectContaining({ title: 'Dirty song', dirty: true }));
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

    it('cancels a save request when a successor project revision arrives before its result', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Project A', dirty: true, projectId: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.updateProject({ title: 'Project B', dirty: true, projectId: 'project-b', revision: 'revision-2' });
        coordinator.resolveSave({ requestId: 1, saved: true, dirty: false });

        await expect(close).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(false);
        expect(send).toHaveBeenCalledWith(
            'save',
            1,
            expect.objectContaining({ projectId: 'project-a', revision: 'revision-1' })
        );
    });

    it('accepts the clean CRDT revision produced by its own close save', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Song', dirty: true, projectId: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.updateProject({ title: 'Song', dirty: false, projectId: 'project-a', revision: 'revision-2' });
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectId: 'project-a',
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(true);
        expect(coordinator.permitsClose()).toBe(true);
    });

    it('rejects a later dirty CRDT revision while a close save is pending', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Song', dirty: true, projectId: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.updateProject({ title: 'Song', dirty: true, projectId: 'project-a', revision: 'revision-3' });
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectId: 'project-a',
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(false);
    });

    it('rejects a clean save result from a different project identity', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Song', dirty: true, projectId: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectId: 'project-b',
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(false);
    });

    it('settles an in-flight request when its renderer window is reset', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send: vi.fn() });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });
        const approval = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resetForWindow();

        await expect(approval).resolves.toBe(false);
    });

    it('waits for a correlated clean discard before approving close', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'discard', send });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        const approval = coordinator.requestClose();
        await Promise.resolve();
        expect(send).toHaveBeenCalledWith('discard', 1, expect.objectContaining({ title: 'Dirty song', dirty: true }));
        coordinator.resolveSave({ requestId: 1, saved: true, dirty: true });

        await expect(approval).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(false);
    });

    it('re-prompts after a failed discard leaves a clean but non-durable replacement', async () => {
        const ask = vi.fn(async () => 'discard' as const);
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask, send });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        const first = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resolveSave({ requestId: 1, saved: false, dirty: true });
        await expect(first).resolves.toBe(false);

        // The failed discard activated a clean replacement, but its first
        // snapshot failed. It remains close-blocking until made durable.
        coordinator.updateProject({ title: 'Untitled Project', dirty: false, durabilityPending: true });
        const second = coordinator.requestClose();
        await Promise.resolve();

        expect(ask).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith(
            'discard',
            2,
            expect.objectContaining({ title: 'Untitled Project', durabilityPending: true })
        );
        coordinator.resolveSave({ requestId: 2, saved: false, dirty: true });
        await expect(second).resolves.toBe(false);
    });

    it('forgets an approved dirty project before a replacement window closes', async () => {
        let coordinator: ReturnType<typeof createWindowCloseCoordinator>;
        const send = vi.fn((_operation: 'save' | 'discard', requestId: number) => {
            coordinator.resolveSave({ requestId, saved: true, dirty: false });
        });
        const ask = vi.fn(async () => 'save' as const);
        coordinator = createWindowCloseCoordinator({ ask, send });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.resetForWindow();

        await expect(coordinator.requestClose()).resolves.toBe(true);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('clears cached dirty state when the renderer window is gone', async () => {
        const ask = vi.fn(async () => 'cancel' as const);
        const coordinator = createWindowCloseCoordinator({ ask, send: vi.fn() });
        coordinator.updateProject({ title: 'Crashed song', dirty: true });

        coordinator.clearForNoWindow();

        await expect(coordinator.requestClose()).resolves.toBe(true);
        expect(ask).not.toHaveBeenCalled();
    });

    it('preserves dirty authority across a renderer-crash replacement but clears it only when no window remains', async () => {
        const ask = vi.fn(async () => 'cancel' as const);
        const coordinator = createWindowCloseCoordinator({ ask, send: vi.fn() });
        coordinator.updateProject({ title: 'Crashed song', dirty: true });

        coordinator.resetForWindow();
        await expect(coordinator.requestClose()).resolves.toBe(false);
        expect(ask).toHaveBeenCalledWith('Crashed song');

        coordinator.clearForNoWindow();
        await expect(coordinator.requestClose()).resolves.toBe(true);
        expect(ask).toHaveBeenCalledTimes(1);
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
        let coordinator: ReturnType<typeof createWindowCloseCoordinator>;
        const send = vi.fn((_operation: 'save' | 'discard', requestId: number) => {
            coordinator.resolveSave({ requestId, saved: true, dirty: false });
        });
        coordinator = createWindowCloseCoordinator({ ask, send });
        coordinator.updateProject({ title: 'Dirty song', dirty: true });

        await expect(coordinator.requestClose()).resolves.toBe(false);
        await expect(coordinator.requestClose()).resolves.toBe(true);

        expect(ask).toHaveBeenCalledTimes(2);
        expect(coordinator.permitsClose()).toBe(true);
    });

    it('fails closed after save dispatch throws and allows a later retry', async () => {
        let coordinator: ReturnType<typeof createWindowCloseCoordinator>;
        const send = vi.fn((_operation: 'save' | 'discard', requestId: number) => {
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

    it('does not let a stale prompt mutate a replacement window close state', async () => {
        let resolveFirstPrompt: ((decision: 'save' | 'discard' | 'cancel') => void) | undefined;
        const ask = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
                        resolveFirstPrompt = resolve;
                    })
            )
            .mockResolvedValueOnce('discard');
        let coordinator: ReturnType<typeof createWindowCloseCoordinator>;
        const send = vi.fn((_operation: 'save' | 'discard', requestId: number) => {
            coordinator.resolveSave({ requestId, saved: true, dirty: false });
        });
        coordinator = createWindowCloseCoordinator({ ask, send });
        coordinator.updateProject({ title: 'First window', dirty: true });

        const staleRequest = coordinator.requestClose();
        coordinator.resetForWindow();
        coordinator.updateProject({ title: 'Replacement window', dirty: true });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        resolveFirstPrompt?.('cancel');

        await expect(staleRequest).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(true);
    });

    it('invalidates a clean approval when a later renderer projection becomes close-blocking', async () => {
        const ask = vi.fn(async () => 'cancel' as const);
        const coordinator = createWindowCloseCoordinator({ ask, send: vi.fn() });
        coordinator.updateProject({ title: 'Song', dirty: false, projectId: 'project-a', revision: 'revision-1' });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.updateProject({ title: 'Song', dirty: true, projectId: 'project-a', revision: 'revision-2' });

        expect(coordinator.permitsClose()).toBe(false);
        await expect(coordinator.requestClose()).resolves.toBe(false);
        expect(ask).toHaveBeenCalledWith('Song');
    });

    it('notifies the shell to restore crash recovery as soon as approved close authority is revoked', async () => {
        const onApprovalRevoked = vi.fn();
        const coordinator = createWindowCloseCoordinator({
            ask: async () => 'cancel',
            send: vi.fn(),
            onApprovalRevoked,
        });
        coordinator.updateProject({ title: 'Song', dirty: false, projectId: 'project-a', revision: 'revision-1' });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.updateProject({ title: 'Song', dirty: true, projectId: 'project-a', revision: 'revision-2' });

        expect(onApprovalRevoked).toHaveBeenCalledTimes(1);
        expect(coordinator.permitsClose()).toBe(false);
    });

    it.each([
        ['a clean revision change', { projectId: 'project-a', revision: 'revision-2' }],
        ['a same-revision project replacement', { projectId: 'project-b', revision: 'revision-1' }],
    ])('revokes an approved close after %s', async (_label, changed) => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'cancel', send: vi.fn() });
        coordinator.updateProject({ title: 'Song', dirty: false, projectId: 'project-a', revision: 'revision-1' });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.updateProject({ title: 'Song', dirty: false, ...changed });

        expect(coordinator.permitsClose()).toBe(false);
    });

    it.each([
        ['a replacement project', { projectId: 'project-b', revision: 'revision-2' }],
        ['an edit to an already-dirty project', { projectId: 'project-a', revision: 'revision-2' }],
    ])('cancels a pending decision after %s changes the renderer authority', async (_label, changed) => {
        let resolvePrompt: ((decision: 'save' | 'discard' | 'cancel') => void) | undefined;
        const ask = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
                        resolvePrompt = resolve;
                    })
            )
            .mockResolvedValueOnce('cancel');
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask, send });
        coordinator.updateProject({ title: 'Project A', dirty: true, projectId: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        coordinator.updateProject({ title: 'Project B', dirty: true, ...changed });
        resolvePrompt?.('discard');

        await expect(close).resolves.toBe(false);
        expect(send).not.toHaveBeenCalled();
        await expect(coordinator.requestClose()).resolves.toBe(false);
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['a clean revision change', { projectId: 'project-a', revision: 'revision-2' }],
        ['a same-revision project replacement', { projectId: 'project-b', revision: 'revision-1' }],
    ])('cancels a pending decision after %s', async (_label, changed) => {
        let resolvePrompt: ((decision: 'save' | 'discard' | 'cancel') => void) | undefined;
        const coordinator = createWindowCloseCoordinator({
            ask: () =>
                new Promise((resolve: (decision: 'save' | 'discard' | 'cancel') => void) => {
                    resolvePrompt = resolve;
                }),
            send: vi.fn(),
        });
        coordinator.updateProject({ title: 'Song', dirty: true, projectId: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        coordinator.updateProject({ title: 'Song', dirty: false, ...changed });
        resolvePrompt?.('save');

        await expect(close).resolves.toBe(false);
    });
});
