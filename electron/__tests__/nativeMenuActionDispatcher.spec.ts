import { describe, expect, it, vi } from 'vitest';

import { createNativeMenuActionDispatcher, type NativeMenuActionWindow } from '../nativeMenuActionDispatcher.js';

const makeWindow = (): NativeMenuActionWindow & { readonly send: ReturnType<typeof vi.fn>; destroyed: boolean } => {
    const window = {
        destroyed: false,
        send: vi.fn(),
        isDestroyed: () => window.destroyed,
        webContents: { send: (...args: Parameters<typeof window.send>) => window.send(...args) },
    };
    return window;
};

describe('native menu action dispatcher', () => {
    it.each([
        [{ action: 'project:new' } as const],
        [{ action: 'project:open-recent', recentKey: 'sourdaw:project:42' } as const],
    ])('creates a macOS renderer and delivers %o only after its matching renderer is ready', (intent) => {
        let current: ReturnType<typeof makeWindow> | undefined;
        const createWindow = vi.fn(() => {
            current = makeWindow();
            return current;
        });
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => current,
            createWindow,
        });

        dispatcher.dispatch(intent);
        const created = current;

        expect(createWindow).toHaveBeenCalledTimes(1);
        expect(created?.send).not.toHaveBeenCalled();
        if (created === undefined) {
            throw new Error('Expected a created renderer window');
        }
        dispatcher.rendererReady(created);

        expect(created.send).toHaveBeenCalledWith('native-menu-action', intent);
    });

    it('does not replay an action into a replacement renderer and never creates one for Edit or View commands', () => {
        let current: ReturnType<typeof makeWindow> | undefined;
        const createWindow = vi.fn(() => {
            current = makeWindow();
            return current;
        });
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => current,
            createWindow,
        });

        dispatcher.dispatch({ action: 'project:new' });
        const stale = current;
        current = makeWindow();
        if (stale === undefined) {
            throw new Error('Expected a queued renderer window');
        }
        dispatcher.rendererReady(stale);
        dispatcher.dispatch({ action: 'edit:copy' });
        current = undefined;
        dispatcher.dispatch({ action: 'view:zoom-in' });

        expect(stale.send).not.toHaveBeenCalled();
        expect(createWindow).toHaveBeenCalledTimes(1);
    });

    it('drops Edit and View commands while a windowless project intent is waiting for its renderer', () => {
        let current: ReturnType<typeof makeWindow> | undefined;
        const createWindow = vi.fn(() => {
            current = makeWindow();
            return current;
        });
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => current,
            createWindow,
        });

        dispatcher.dispatch({ action: 'project:new' });
        const pendingWindow = current;
        dispatcher.dispatch({ action: 'edit:undo' });
        dispatcher.dispatch({ action: 'view:zoom-in' });
        if (pendingWindow === undefined) {
            throw new Error('Expected a pending renderer window');
        }
        dispatcher.rendererReady(pendingWindow);

        expect(pendingWindow.send).toHaveBeenCalledTimes(1);
        expect(pendingWindow.send).toHaveBeenCalledWith('native-menu-action', { action: 'project:new' });
    });

    it('holds supported project transitions for every newly registered unready renderer', () => {
        const startup = makeWindow();
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => startup,
            createWindow: () => startup,
        });
        dispatcher.registerWindow(startup);

        dispatcher.dispatch({ action: 'project:new' });
        dispatcher.dispatch({ action: 'project:open-recent', recentKey: 'saved-project' });

        expect(startup.send).not.toHaveBeenCalled();
        dispatcher.rendererReady(startup);
        expect(startup.send).toHaveBeenCalledTimes(2);
    });

    it.each([
        { action: 'project:save' } as const,
        { action: 'project:discard' } as const,
        { action: 'project:import-audio' } as const,
        { action: 'project:export-audio' } as const,
    ])('drops unsupported windowless project intent %o before renderer readiness', (intent) => {
        const startup = makeWindow();
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => startup,
            createWindow: () => startup,
        });
        dispatcher.registerWindow(startup);

        dispatcher.dispatch(intent);
        dispatcher.rendererReady(startup);

        expect(startup.send).not.toHaveBeenCalled();
    });

    it('holds correlated close save and discard only for their exact registered unready renderer', () => {
        const startup = makeWindow();
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => startup,
            createWindow: () => startup,
        });
        dispatcher.registerWindow(startup);

        dispatcher.dispatch({
            action: 'project:save',
            requestId: 7,
            projectKey: 'project-a',
            revision: 'revision-1',
        });
        dispatcher.dispatch({
            action: 'project:discard',
            requestId: 8,
            projectKey: 'project-a',
            revision: 'revision-1',
        });

        expect(startup.send).not.toHaveBeenCalled();
        dispatcher.rendererReady(startup);
        expect(startup.send).toHaveBeenNthCalledWith(1, 'native-menu-action', {
            action: 'project:save',
            requestId: 7,
            projectKey: 'project-a',
            revision: 'revision-1',
        });
        expect(startup.send).toHaveBeenNthCalledWith(2, 'native-menu-action', {
            action: 'project:discard',
            requestId: 8,
            projectKey: 'project-a',
            revision: 'revision-1',
        });
    });

    it('does not carry unsupported project intents across an unready renderer crash', () => {
        let current: ReturnType<typeof makeWindow> | undefined;
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => current,
            createWindow: () => {
                current = makeWindow();
                return current;
            },
        });
        const crashed = makeWindow();
        current = crashed;
        dispatcher.registerWindow(crashed);
        dispatcher.dispatch({ action: 'project:save' });
        const replacement = makeWindow();
        current = replacement;
        dispatcher.recoverPendingWindow(crashed, replacement);
        dispatcher.rendererReady(replacement);

        expect(replacement.send).not.toHaveBeenCalled();
    });

    it('transfers supported queued actions only to the exact crash-recovery replacement', () => {
        let current: ReturnType<typeof makeWindow> | undefined;
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => current,
            createWindow: () => {
                current = makeWindow();
                return current;
            },
        });

        dispatcher.dispatch({ action: 'project:new' });
        dispatcher.dispatch({ action: 'project:open-recent', recentKey: 'saved-project' });
        const crashed = current;
        const replacement = makeWindow();
        current = replacement;
        if (crashed === undefined) {
            throw new Error('Expected a pending renderer window');
        }

        dispatcher.recoverPendingWindow(crashed, replacement);
        dispatcher.rendererReady(replacement);

        expect(replacement.send).toHaveBeenNthCalledWith(1, 'native-menu-action', { action: 'project:new' });
        expect(replacement.send).toHaveBeenNthCalledWith(2, 'native-menu-action', {
            action: 'project:open-recent',
            recentKey: 'saved-project',
        });
    });

    it('clears queued actions for intentional, unrelated, and exhausted replacements', () => {
        let current: ReturnType<typeof makeWindow> | undefined;
        const dispatcher = createNativeMenuActionDispatcher({
            isMac: true,
            actionChannel: 'native-menu-action',
            getWindow: () => current,
            createWindow: () => {
                current = makeWindow();
                return current;
            },
        });

        dispatcher.dispatch({ action: 'project:new' });
        const pending = current;
        const replacement = makeWindow();
        current = replacement;
        if (pending === undefined) {
            throw new Error('Expected a pending renderer window');
        }
        dispatcher.clearPending(pending);
        dispatcher.rendererReady(replacement);
        dispatcher.clearPending();

        expect(replacement.send).not.toHaveBeenCalled();
    });
});
