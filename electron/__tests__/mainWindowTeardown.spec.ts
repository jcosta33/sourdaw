/**
 * Main-window owner teardown wiring exercised without reading `main.ts`.
 *
 * Pins the bind that `createWindow` must perform and the crash destroy that
 * must use the captured detach-first path instead of CloseImmediately.
 * Detach behaviour itself lives in `pluginGui.spec.ts`; this file only stubs
 * the `OwnerWindow` / `PluginWindowHost` surface those helpers call.
 */
import { describe, expect, it, vi } from 'vitest';

import { bindMainWindowOwnerTeardown, destroyCrashedMainWindow } from '../mainWindowTeardown.js';

import type { OwnerWindow, PluginWindowHost, PreventableEditorEvent } from '../pluginGui.js';

type OwnerStub = OwnerWindow & {
    readonly hide: ReturnType<typeof vi.fn<() => void>>;
    readonly destroy: ReturnType<typeof vi.fn<() => void>>;
    readonly emitClose: () => boolean;
};

const createOwnerStub = (): OwnerStub => {
    const closeListeners: Array<(event: PreventableEditorEvent) => void> = [];
    let destroyed = false;
    return {
        on: (event: 'close', listener: (event: PreventableEditorEvent) => void) => {
            if (event === 'close') {
                closeListeners.push(listener);
            }
        },
        hide: vi.fn<() => void>(),
        destroy: vi.fn<() => void>(() => {
            destroyed = true;
        }),
        isDestroyed: () => destroyed,
        emitClose: () => {
            let prevented = false;
            const event: PreventableEditorEvent = {
                preventDefault: () => {
                    prevented = true;
                },
            };
            for (const listener of closeListeners) {
                listener(event);
            }
            return prevented;
        },
    };
};

const createHostStub = (
    detachOpenEditors: PluginWindowHost['detachOpenEditors'] = vi.fn((): Promise<void> => Promise.resolve())
): PluginWindowHost => ({
    create: () => ({ handle: null, parented: false, scaleFactor: 1, error: 'unused in wiring stubs' }),
    exists: () => false,
    setSize: () => {},
    setResizable: () => {},
    showAndFocus: () => {},
    destroy: () => {},
    hide: () => {},
    show: () => {},
    detachOpenEditors,
});

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('main window owner teardown wiring', () => {
    it('returns no crash destroy when createWindow never bound a plugin host', () => {
        const owner = createOwnerStub();

        const destroyAfterEditorsDetach = bindMainWindowOwnerTeardown(owner, undefined);

        expect(destroyAfterEditorsDetach).toBeUndefined();
    });

    it('binds detach-first owner teardown when the plugin window host is live', async () => {
        const owner = createOwnerStub();
        const detachOpenEditors = vi.fn((): Promise<void> => Promise.resolve());
        const host = createHostStub(detachOpenEditors);

        const destroyAfterEditorsDetach = bindMainWindowOwnerTeardown(owner, host);
        expect(destroyAfterEditorsDetach).toBeDefined();

        await destroyAfterEditorsDetach?.();

        expect(detachOpenEditors).toHaveBeenCalledTimes(1);
        expect(owner.hide).toHaveBeenCalled();
        expect(owner.destroy).toHaveBeenCalledTimes(1);
        expect(owner.isDestroyed()).toBe(true);
    });

    it('stops the owner close through the bound detach-first path', async () => {
        const owner = createOwnerStub();
        const detachOpenEditors = vi.fn((): Promise<void> => Promise.resolve());
        bindMainWindowOwnerTeardown(owner, createHostStub(detachOpenEditors));

        const stopped = owner.emitClose();
        await settled();

        expect(stopped).toBe(true);
        expect(detachOpenEditors).toHaveBeenCalledTimes(1);
        expect(owner.destroy).toHaveBeenCalledTimes(1);
    });

    it('leaves a cancelled dirty close untouched', async () => {
        const owner = createOwnerStub();
        const detachOpenEditors = vi.fn((): Promise<void> => Promise.resolve());
        bindMainWindowOwnerTeardown(owner, createHostStub(detachOpenEditors), () => false);

        const stopped = owner.emitClose();
        await settled();

        expect(stopped).toBe(false);
        expect(detachOpenEditors).not.toHaveBeenCalled();
        expect(owner.hide).not.toHaveBeenCalled();
        expect(owner.destroy).not.toHaveBeenCalled();
    });

    it('destroys a crashed main window through the captured detach-first path after recovery rebinding', async () => {
        const crashedOwner = createOwnerStub();
        let releaseDetach!: () => void;
        const detachOpenEditors = vi.fn(
            (): Promise<void> =>
                new Promise<void>((resolve) => {
                    releaseDetach = resolve;
                })
        );
        const host = createHostStub(detachOpenEditors);

        const destroyAfterEditorsDetach = bindMainWindowOwnerTeardown(crashedOwner, host);
        expect(destroyAfterEditorsDetach).toBeDefined();

        const capturedDestroy = destroyAfterEditorsDetach;
        bindMainWindowOwnerTeardown(createOwnerStub(), host);

        destroyCrashedMainWindow(crashedOwner, capturedDestroy);
        await settled();

        expect(detachOpenEditors).toHaveBeenCalledTimes(1);
        expect(crashedOwner.hide).toHaveBeenCalled();
        expect(crashedOwner.destroy).not.toHaveBeenCalled();
        expect(crashedOwner.isDestroyed()).toBe(false);

        releaseDetach();
        await settled();

        expect(crashedOwner.destroy).toHaveBeenCalledTimes(1);
        expect(crashedOwner.isDestroyed()).toBe(true);
    });

    it('falls back to platform destroy when crash recovery had no bound host', () => {
        const crashedOwner = createOwnerStub();

        destroyCrashedMainWindow(crashedOwner, undefined);

        expect(crashedOwner.destroy).toHaveBeenCalledTimes(1);
    });
});
