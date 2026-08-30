import { describe, expect, it, vi } from 'vitest';

import { createRendererSessionLifecycle } from '../rendererSessionLifecycle.js';
import {
    composeQuitHandler,
    installMacApplicationMenu,
    requestApprovedWindowClose,
    shouldRecreateRendererAfterCrash,
    createProductionShellComposition,
} from '../shellComposition.js';

describe('Electron shell composition policies', () => {
    it('installs the built native menu only on macOS', () => {
        const build = vi.fn(() => ({ menu: true }));
        const set = vi.fn();
        installMacApplicationMenu({ isMac: true, build, set, template: [] });
        expect(build).toHaveBeenCalledWith([]);
        expect(set).toHaveBeenCalledWith({ menu: true });
        installMacApplicationMenu({ isMac: false, build, set, template: [] });
        expect(build).toHaveBeenCalledOnce();
    });

    it('prevents dirty close until correlated approval re-enters close', async () => {
        const event = { preventDefault: vi.fn() };
        const close = vi.fn();
        requestApprovedWindowClose({ event, requestClose: async () => true, close });
        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('composes quit with both permission and renderer quiescence', async () => {
        const canQuit = vi.fn(async () => true);
        const beforeRun = vi.fn(async () => 'success' as const);
        const run = vi.fn(async () => ({ status: 'completed' as const, report: undefined }));
        const handler = composeQuitHandler(run, { canQuit, beforeRun, exit: vi.fn(), report: vi.fn() });
        handler({ preventDefault: vi.fn() });
        await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
        expect(canQuit).toHaveBeenCalledOnce();
        expect(beforeRun).toHaveBeenCalledOnce();
    });

    it('uses renderer lifecycle approval to suppress crash recreation', () => {
        expect(shouldRecreateRendererAfterCrash({ shouldRecreateAfterCrash: () => false })).toBe(false);
        expect(shouldRecreateRendererAfterCrash({ shouldRecreateAfterCrash: () => true })).toBe(true);
    });

    const productionComposition = ({
        focused = 'main',
        quiesceBeforeQuit = vi.fn(async () => 'success' as const),
        runShutdown = vi.fn(async () => ({ status: 'completed' as const, report: undefined })),
        lifecycle = createRendererSessionLifecycle(),
    }: {
        focused?: 'main' | 'plugin';
        quiesceBeforeQuit?: ReturnType<typeof vi.fn<() => Promise<'success'>>>;
        runShutdown?: ReturnType<typeof vi.fn<() => Promise<{ status: 'completed'; report: undefined }>>>;
        lifecycle?: ReturnType<typeof createRendererSessionLifecycle>;
    } = {}) => {
        const editTarget = {
            undo: vi.fn(),
            redo: vi.fn(),
            cut: vi.fn(),
            copy: vi.fn(),
            paste: vi.fn(),
            selectAll: vi.fn(),
        };
        const mainWindow = { isDestroyed: () => false, webContents: editTarget };
        const pluginWindow = {};
        const dispatchMenuIntent = vi.fn();
        const responder = vi.fn();
        const composition = createProductionShellComposition({
            isMac: true,
            buildMenu: vi.fn(() => ({ menu: true })),
            setMenu: vi.fn(),
            getMainWindow: () => mainWindow,
            getFocusedWindow: () => (focused === 'main' ? mainWindow : pluginWindow),
            sendToFirstResponder: responder,
            menuDispatcher: { dispatch: dispatchMenuIntent },
            runShutdown,
            quit: {
                canQuit: vi.fn(async () => true),
                quiesceBeforeQuit,
                exit: vi.fn(),
                report: vi.fn(),
            },
            lifecycle,
        });

        return { composition, dispatchMenuIntent, editTarget, responder, quiesceBeforeQuit, runShutdown };
    };

    it('applies a main-focused Edit action and dispatches its renderer intent', () => {
        const { composition, dispatchMenuIntent, editTarget, responder } = productionComposition();

        composition.sendMenuIntent({ action: 'edit:copy' });

        expect(editTarget.copy).toHaveBeenCalledOnce();
        expect(dispatchMenuIntent).toHaveBeenCalledWith({ action: 'edit:copy' });
        expect(responder).not.toHaveBeenCalled();
    });

    it('routes plugin-focused Edit only through the native responder chain', () => {
        const { composition, dispatchMenuIntent, editTarget, responder } = productionComposition({ focused: 'plugin' });

        composition.sendMenuIntent({ action: 'edit:copy' });

        expect(responder).toHaveBeenCalledWith('copy:');
        expect(dispatchMenuIntent).not.toHaveBeenCalled();
        expect(editTarget.copy).not.toHaveBeenCalled();
    });

    it('dispatches non-Edit actions without applying native text editing', () => {
        const { composition, dispatchMenuIntent, editTarget, responder } = productionComposition();

        composition.sendMenuIntent({ action: 'view:toggle-mixer' });

        expect(dispatchMenuIntent).toHaveBeenCalledWith({ action: 'view:toggle-mixer' });
        expect(editTarget.copy).not.toHaveBeenCalled();
        expect(responder).not.toHaveBeenCalled();
    });

    it('runs the required renderer quiesce before native shutdown on before-quit', async () => {
        const order: string[] = [];
        const quiesceBeforeQuit = vi.fn(async () => {
            order.push('quiesce');
            return 'success' as const;
        });
        const runShutdown = vi.fn(async () => {
            order.push('shutdown');
            return { status: 'completed' as const, report: undefined };
        });
        const { composition } = productionComposition({ quiesceBeforeQuit, runShutdown });

        composition.beforeQuit({ preventDefault: vi.fn() });

        await vi.waitFor(() => expect(runShutdown).toHaveBeenCalledOnce());
        expect(order).toEqual(['quiesce', 'shutdown']);
    });

    it('uses the approved production lifecycle to suppress renderer crash recreation', () => {
        const lifecycle = createRendererSessionLifecycle();
        lifecycle.approveTeardown();
        const { composition } = productionComposition({ lifecycle });

        expect(composition.shouldRecreateAfterCrash()).toBe(false);
    });
});
