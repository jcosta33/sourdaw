import { describe, expect, it, vi } from 'vitest';

import {
    composeQuitHandler,
    installMacApplicationMenu,
    requestApprovedWindowClose,
    shouldRecreateRendererAfterCrash,
    createShellComposition,
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

    it('composes production callbacks for focused Edit, Darwin menu, quit drain, and crash lifecycle', async () => {
        const dispatchMenuIntent = vi.fn();
        const responder = vi.fn();
        const buildMenu = vi.fn(() => ({ menu: true }));
        const setMenu = vi.fn();
        const canQuit = vi.fn(async () => true);
        const beforeRun = vi.fn(async () => 'success' as const);
        const runShutdown = vi.fn(async () => ({ status: 'completed' as const, report: undefined }));
        const composition = createShellComposition({
            isMac: true,
            buildMenu,
            setMenu,
            getMainTarget: () => ({
                undo: vi.fn(),
                redo: vi.fn(),
                cut: vi.fn(),
                copy: vi.fn(),
                paste: vi.fn(),
                selectAll: vi.fn(),
            }),
            isMainTargetFocused: () => false,
            sendToNativeResponder: responder,
            dispatchMenuIntent,
            runShutdown,
            quitDependencies: { canQuit, beforeRun, exit: vi.fn(), report: vi.fn() },
            lifecycle: { shouldRecreateAfterCrash: () => false },
        });
        composition.sendMenuIntent({ action: 'edit:copy' });
        expect(responder).toHaveBeenCalledWith('copy:');
        expect(dispatchMenuIntent).not.toHaveBeenCalled();
        composition.installMenu([]);
        expect(setMenu).toHaveBeenCalledWith({ menu: true });
        composition.beforeQuit({ preventDefault: vi.fn() });
        await vi.waitFor(() => expect(runShutdown).toHaveBeenCalledOnce());
        expect(beforeRun).toHaveBeenCalledBefore(runShutdown);
        expect(composition.shouldRecreateAfterCrash()).toBe(false);
    });
});
