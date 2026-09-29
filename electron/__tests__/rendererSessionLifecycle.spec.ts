import { describe, expect, it } from 'vitest';

import { createRendererSessionLifecycle, isRendererReplacingNavigation } from '../rendererSessionLifecycle.js';
import { createWindowCloseCoordinator } from '../windowCloseCoordinator.js';

describe('renderer session lifecycle', () => {
    it('does not recreate a renderer that crashes while approved editor-detach teardown is still pending', () => {
        const lifecycle = createRendererSessionLifecycle();

        lifecycle.startWindow();
        lifecycle.approveTeardown();

        expect(lifecycle.shouldRecreateAfterCrash()).toBe(false);
    });

    it('allows crash recovery again for a replacement session window', () => {
        const lifecycle = createRendererSessionLifecycle();

        lifecycle.approveTeardown();
        lifecycle.startWindow();

        expect(lifecycle.shouldRecreateAfterCrash()).toBe(true);
    });

    it('allows crash recovery again when approved teardown is cancelled', () => {
        const lifecycle = createRendererSessionLifecycle();
        lifecycle.approveTeardown();

        lifecycle.cancelTeardown();

        expect(lifecycle.shouldRecreateAfterCrash()).toBe(true);
    });

    it('restores crash recovery before delayed detach completes when approved close authority is revoked', async () => {
        const lifecycle = createRendererSessionLifecycle();
        const coordinator = createWindowCloseCoordinator({
            ask: async () => 'cancel',
            send: () => undefined,
            onApprovalRevoked: () => lifecycle.cancelTeardown(),
        });
        coordinator.updateProject({ title: 'Song', dirty: false, projectKey: 'project-a', revision: 'revision-1' });

        await coordinator.requestClose();
        lifecycle.approveTeardown();
        coordinator.updateProject({ title: 'Song', dirty: true, projectKey: 'project-a', revision: 'revision-2' });

        expect(lifecycle.shouldRecreateAfterCrash()).toBe(true);
    });
});

// The session-generation bump for a same-window reload must fire when the
// replacing navigation begins (#4752): the incoming renderer's startup disarm
// is not held back by module evaluation, so an arm the outgoing page left in
// flight has to be stale before that disarm settles.
describe('renderer-replacing navigation', () => {
    it('begins a session for a main-frame cross-document navigation, a reload included', () => {
        expect(isRendererReplacingNavigation({ isInPlace: false, isMainFrame: true })).toBe(true);
    });

    it('keeps the session for a sub-frame navigation', () => {
        expect(isRendererReplacingNavigation({ isInPlace: false, isMainFrame: false })).toBe(false);
    });

    it('keeps the session for a same-document navigation', () => {
        expect(isRendererReplacingNavigation({ isInPlace: true, isMainFrame: true })).toBe(false);
        expect(isRendererReplacingNavigation({ isInPlace: true, isMainFrame: false })).toBe(false);
    });
});
