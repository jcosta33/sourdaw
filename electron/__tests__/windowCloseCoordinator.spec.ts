import { describe, expect, it, vi } from 'vitest';

import { createWindowCloseCoordinator } from '../windowCloseCoordinator.js';

describe('window close coordinator', () => {
    it('fails closed for every new renderer generation until hydrated project truth is ready', async () => {
        const ask = vi.fn(async () => 'cancel' as const);
        const coordinator = createWindowCloseCoordinator({ ask, send: vi.fn() });

        await expect(coordinator.requestClose()).resolves.toBe(false);
        coordinator.updateProject({ title: 'Provisional', dirty: false, rendererReady: false });
        await expect(coordinator.requestClose()).resolves.toBe(false);
        coordinator.updateProject({ title: 'Loaded', dirty: false, rendererReady: true });
        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.resetForWindow();
        await expect(coordinator.requestClose()).resolves.toBe(false);

        expect(ask).not.toHaveBeenCalled();
    });

    it('retains dirty crash authority until the replacement renderer publishes hydrated project truth', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'cancel', send: vi.fn() });
        coordinator.updateProject({
            title: 'Unsaved song',
            dirty: true,
            projectKey: 'project-a',
            revision: 'revision-1',
        });
        coordinator.resetForWindow();

        coordinator.updateProject({
            title: 'Sourdaw',
            dirty: false,
            projectKey: 'provisional',
            revision: 'revision-0',
            rendererReady: false,
        });

        await expect(coordinator.requestClose()).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(false);

        coordinator.updateProject({
            title: 'Recovered song',
            dirty: false,
            projectKey: 'project-a',
            revision: 'revision-1',
            rendererReady: true,
        });
        await expect(coordinator.requestClose()).resolves.toBe(true);
    });

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
        coordinator.updateProject({ title: 'Project A', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.updateProject({ title: 'Project B', dirty: true, projectKey: 'project-b', revision: 'revision-2' });
        coordinator.resolveSave({ requestId: 1, saved: true, dirty: false });

        await expect(close).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(false);
        expect(send).toHaveBeenCalledWith(
            'save',
            1,
            expect.objectContaining({ projectKey: 'project-a', revision: 'revision-1' })
        );
    });

    it('accepts the clean CRDT revision produced by its own close save', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        // Saving itself advances the CRDT revision before all durable writes
        // settle. The matching correlated clean result may approve that exact
        // successor even though its intermediate projection is still dirty.
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-2' });
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectKey: 'project-a',
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(true);
        expect(coordinator.permitsClose()).toBe(true);
    });

    it('accepts a legacy save after canonical identity migration because its stable snapshot key is unchanged', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        const legacySnapshotKey = 'sourdaw:project:1700000000000';
        coordinator.updateProject({
            title: 'Legacy song',
            dirty: true,
            projectKey: legacySnapshotKey,
            revision: 'revision-1',
        });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.updateProject({
            title: 'Legacy song',
            dirty: true,
            projectKey: legacySnapshotKey,
            revision: 'revision-2',
        });
        // The renderer may mint a canonical projectId while saving; that
        // identity is deliberately absent from this close protocol.
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectKey: legacySnapshotKey,
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(true);
    });

    it('rejects a later dirty CRDT revision while a close save is pending', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-3' });
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectKey: 'project-a',
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(false);
        expect(coordinator.permitsClose()).toBe(false);
    });

    it('rejects a clean save result from a different project snapshot key', async () => {
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send });
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectKey: 'project-b',
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(false);
    });

    it('rejects an unprojected same-key result revision that was not produced by the close save', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send: vi.fn() });
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectKey: 'project-a',
            revision: 'unrelated-revision',
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

    it('accepts the clean replacement key produced by its correlated never-saved discard', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'discard', send: vi.fn() });
        coordinator.updateProject({
            title: 'Untitled',
            dirty: true,
            projectKey: 'sourdaw:project:1',
            revision: 'revision-1',
        });

        const close = coordinator.requestClose();
        await Promise.resolve();
        coordinator.updateProject({
            title: 'Untitled Project',
            dirty: false,
            projectKey: 'sourdaw:project:2',
            revision: 'revision-2',
        });
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectKey: 'sourdaw:project:2',
            revision: 'revision-2',
        });

        await expect(close).resolves.toBe(true);
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
        coordinator.updateProject({ title: 'Replacement', dirty: false, rendererReady: true });

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
        expect(ask).not.toHaveBeenCalled();

        coordinator.clearForNoWindow();
        await expect(coordinator.requestClose()).resolves.toBe(true);
        expect(ask).not.toHaveBeenCalled();
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
        coordinator.updateProject({ title: 'Song', dirty: false, projectKey: 'project-a', revision: 'revision-1' });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-2' });

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
        coordinator.updateProject({ title: 'Song', dirty: false, projectKey: 'project-a', revision: 'revision-1' });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-2' });

        expect(onApprovalRevoked).toHaveBeenCalledTimes(1);
        expect(coordinator.permitsClose()).toBe(false);
    });

    it.each([
        ['a clean revision change', { projectKey: 'project-a', revision: 'revision-2' }],
        ['a same-revision project replacement', { projectKey: 'project-b', revision: 'revision-1' }],
    ])('revokes an approved close after %s', async (_label, changed) => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'cancel', send: vi.fn() });
        coordinator.updateProject({ title: 'Song', dirty: false, projectKey: 'project-a', revision: 'revision-1' });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.updateProject({ title: 'Song', dirty: false, ...changed });

        expect(coordinator.permitsClose()).toBe(false);
    });

    it.each([
        ['a replacement project', { projectKey: 'project-b', revision: 'revision-2' }],
        ['an edit to an already-dirty project', { projectKey: 'project-a', revision: 'revision-2' }],
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
        coordinator.updateProject({ title: 'Project A', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        coordinator.updateProject({ title: 'Project B', dirty: true, ...changed });
        resolvePrompt?.('discard');

        await expect(close).resolves.toBe(false);
        expect(send).not.toHaveBeenCalled();
        await expect(coordinator.requestClose()).resolves.toBe(false);
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['a clean revision change', { projectKey: 'project-a', revision: 'revision-2' }],
        ['a same-revision project replacement', { projectKey: 'project-b', revision: 'revision-1' }],
    ])('cancels a pending decision after %s', async (_label, changed) => {
        let resolvePrompt: ((decision: 'save' | 'discard' | 'cancel') => void) | undefined;
        const coordinator = createWindowCloseCoordinator({
            ask: () =>
                new Promise((resolve: (decision: 'save' | 'discard' | 'cancel') => void) => {
                    resolvePrompt = resolve;
                }),
            send: vi.fn(),
        });
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const close = coordinator.requestClose();
        coordinator.updateProject({ title: 'Song', dirty: false, ...changed });
        resolvePrompt?.('save');

        await expect(close).resolves.toBe(false);
    });

    it('revokes an approved close when the same revision becomes close-blocking', async () => {
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'cancel', send: vi.fn() });
        coordinator.updateProject({ title: 'Song', dirty: false, projectKey: 'project-a', revision: 'revision-1' });

        await expect(coordinator.requestClose()).resolves.toBe(true);
        coordinator.updateProject({
            title: 'Song',
            dirty: false,
            durabilityPending: true,
            projectKey: 'project-a',
            revision: 'revision-1',
        });

        expect(coordinator.permitsClose()).toBe(false);
    });

    it('times out a renderer close operation, leaves the window open, and allows a later retry', async () => {
        let timeout: (() => void) | undefined;
        const timer = { cancel: vi.fn() };
        const timers = {
            setTimer: vi.fn((callback: () => void) => {
                timeout = callback;
                return timer;
            }),
        };
        const send = vi.fn();
        const coordinator = createWindowCloseCoordinator({ ask: async () => 'save', send, timers });
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const first = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        timeout?.();

        await expect(first).resolves.toBe(false);
        expect(timer.cancel).toHaveBeenCalledTimes(1);
        expect(coordinator.permitsClose()).toBe(false);

        const second = coordinator.requestClose();
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        coordinator.resolveSave({
            requestId: 2,
            saved: true,
            dirty: false,
            projectKey: 'project-a',
            revision: 'revision-1',
        });
        await expect(second).resolves.toBe(true);
    });

    it('cancels a close-operation deadline when a result or window reset settles it', async () => {
        const timers: { callbacks: (() => void)[]; cancels: ReturnType<typeof vi.fn>[] } = {
            callbacks: [],
            cancels: [],
        };
        const coordinator = createWindowCloseCoordinator({
            ask: async () => 'save',
            send: vi.fn(),
            timers: {
                setTimer: (callback) => {
                    const cancel = vi.fn();
                    timers.callbacks.push(callback);
                    timers.cancels.push(cancel);
                    return { cancel };
                },
            },
        });
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-1' });

        const resolved = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resolveSave({
            requestId: 1,
            saved: true,
            dirty: false,
            projectKey: 'project-a',
            revision: 'revision-1',
        });
        await expect(resolved).resolves.toBe(true);
        expect(timers.cancels[0]).toHaveBeenCalledTimes(1);

        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-2' });
        const reset = coordinator.requestClose();
        await Promise.resolve();
        coordinator.resetForWindow();
        await expect(reset).resolves.toBe(false);
        expect(timers.cancels[1]).toHaveBeenCalledTimes(1);
    });
});
