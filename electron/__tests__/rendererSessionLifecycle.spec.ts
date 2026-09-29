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

// The session-generation bump rides `did-navigate` (#4752): Electron fires it
// only for a committed main-frame cross-document navigation, after every
// cancellable navigation event, so a navigation the shell vetoes at
// `will-navigate` never reaches it — while still landing ahead of the
// successor's module evaluation and its startup disarm. The excluded classes
// never produce a payload here to classify: a sub-frame completion reports
// only through `did-frame-navigate`, a same-document one only through
// `did-navigate-in-page` (electron.d.ts, `did-navigate`: "Emitted when a main
// frame navigation is done. This event is not emitted for in-page
// navigations…"). The classes below pin the payload decision itself.
describe('renderer-replacing navigation', () => {
    it('begins a session for the committed boot load of a session window, a non-HTTP origin included', () => {
        expect(
            isRendererReplacingNavigation({ url: 'file:///app/index.html', httpResponseCode: -1, httpStatusText: '' })
        ).toBe(true);
    });

    it('begins a session for a committed reload or page change', () => {
        expect(
            isRendererReplacingNavigation({
                url: 'http://127.0.0.1:5173/',
                httpResponseCode: 200,
                httpStatusText: 'OK',
            })
        ).toBe(true);
    });

    it('begins a session when the commit is an error page, because the renderer is replaced all the same', () => {
        expect(
            isRendererReplacingNavigation({
                url: 'http://127.0.0.1:5173/missing',
                httpResponseCode: 404,
                httpStatusText: 'Not Found',
            })
        ).toBe(true);
    });
});
