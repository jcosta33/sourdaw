import { describe, expect, it, vi } from 'vitest';

import {
    composeQuitHandler,
    installMacApplicationMenu,
    requestApprovedWindowClose,
    shouldRecreateRendererAfterCrash,
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
        const beforeRun = vi.fn(async () => true);
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
});
