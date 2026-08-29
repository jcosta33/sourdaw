/**
 * Main-window owner teardown wiring exercised without reading `main.ts`.
 *
 * Pins the bind that `createWindow` must perform and the crash destroy that
 * must use the captured detach-first path instead of CloseImmediately.
 */
import { describe, expect, it, vi } from 'vitest';

import { bindMainWindowOwnerTeardown, destroyCrashedMainWindow } from '../mainWindowTeardown.js';
import {
    createPluginWindowHost,
    type CreateEditorWindowRequest,
    type EditorSize,
    type EditorWindow,
    type EditorWindowOptions,
    type PluginWindowHostDeps,
    type PreventableEditorEvent,
} from '../pluginGui.js';

type CloseListener = (event: PreventableEditorEvent) => void;

type FakeWindow = EditorWindow & {
    readonly emitClose: () => boolean;
    readonly emitClosed: () => void;
    readonly options: EditorWindowOptions;
    readonly hide: ReturnType<typeof vi.fn<() => void>>;
    readonly destroy: ReturnType<typeof vi.fn<() => void>>;
};

type FakeOwnerWindow = FakeWindow & {
    readonly adopt: (child: FakeWindow) => void;
};

const createFakeWindow = (options: EditorWindowOptions): FakeWindow => {
    const closeListeners: CloseListener[] = [];
    const closedListeners: (() => void)[] = [];
    let destroyed = false;
    const emitClosed = (): void => {
        destroyed = true;
        for (const listener of closedListeners) {
            listener();
        }
    };
    return {
        options,
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
            if (!prevented) {
                emitClosed();
            }
            return prevented;
        },
        emitClosed,
        getNativeWindowHandle: () => Buffer.alloc(8, 1),
        setContentSize: vi.fn(),
        getContentSize: () => [800, 600],
        getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        setResizable: vi.fn(),
        show: vi.fn(),
        showInactive: vi.fn(),
        focus: vi.fn(),
        hide: vi.fn(),
        destroy: vi.fn(() => {
            emitClosed();
        }),
        isDestroyed: () => destroyed,
        on: (event: string, listener: (() => void) | CloseListener) => {
            if (event === 'close') {
                closeListeners.push(listener);
                return;
            }
            if (event === 'closed') {
                closedListeners.push(listener);
            }
        },
    };
};

const createFakeOwnerWindow = (): FakeOwnerWindow => {
    const children: FakeWindow[] = [];
    const window = createFakeWindow({ title: 'Sourdaw', parent: undefined, alwaysOnTop: false });
    const destroySelf = window.destroy;
    return {
        ...window,
        adopt: (child) => {
            children.push(child);
        },
        destroy: vi.fn(() => {
            for (const child of children) {
                if (!child.isDestroyed()) {
                    child.emitClosed();
                }
            }
            destroySelf();
        }),
    };
};

const request = (): CreateEditorWindowRequest => ({
    label: 'plugin-a',
    instanceId: 'instance-a',
    title: 'Surge XT',
    width: 800,
    height: 600,
    resizable: true,
});

type Harness = {
    readonly host: ReturnType<typeof createPluginWindowHost>;
    readonly windows: FakeWindow[];
    readonly notifyClosed: ReturnType<typeof vi.fn<(instanceId: string, label: string) => Promise<void>>>;
};

const createHarness = (
    overrides: Partial<PluginWindowHostDeps> = {},
    notifyClosed: ReturnType<typeof vi.fn<(instanceId: string, label: string) => Promise<void>>>
): Harness => {
    const windows: FakeWindow[] = [];
    const host = createPluginWindowHost({
        createWindow: (options) => {
            const window = createFakeWindow(options);
            windows.push(window);
            return window;
        },
        getParentWindow: overrides.getParentWindow,
        getScaleFactor: overrides.getScaleFactor ?? (() => 1),
        watchDisplayChanges: overrides.watchDisplayChanges ?? (() => undefined),
        requestEditorSize:
            overrides.requestEditorSize ??
            vi.fn((_instanceId: string, width: number, height: number): Promise<EditorSize> =>
                Promise.resolve({ width, height })
            ),
        applyEditorScale:
            overrides.applyEditorScale ??
            vi.fn((): Promise<EditorSize> => Promise.resolve({ width: 800, height: 600 })),
        notifyClosed,
    });
    return { host, windows, notifyClosed };
};

const onlyWindow = (windows: FakeWindow[]): FakeWindow => {
    const window = windows[0];
    if (window === undefined) {
        throw new Error('expected a window');
    }
    return window;
};

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('main window owner teardown wiring', () => {
    it('returns no crash destroy when createWindow never bound a plugin host', () => {
        const owner = createFakeOwnerWindow();

        const destroyAfterEditorsDetach = bindMainWindowOwnerTeardown(owner, undefined);

        expect(destroyAfterEditorsDetach).toBeUndefined();
    });

    it('binds detach-first owner teardown when the plugin window host is live', async () => {
        const owner = createFakeOwnerWindow();
        const windowAliveAtReport: boolean[] = [];
        let harness: Harness;
        const notifyClosed = vi.fn((): Promise<void> => {
            windowAliveAtReport.push(!onlyWindow(harness.windows).isDestroyed());
            return Promise.resolve();
        });
        harness = createHarness({ getParentWindow: () => owner as never }, notifyClosed);

        const destroyAfterEditorsDetach = bindMainWindowOwnerTeardown(owner, harness.host);
        expect(destroyAfterEditorsDetach).toBeDefined();

        harness.host.create(request());
        owner.adopt(onlyWindow(harness.windows));

        await destroyAfterEditorsDetach?.();

        expect(windowAliveAtReport).toEqual([true, false]);
        expect(owner.isDestroyed()).toBe(true);
        expect(owner.hide).toHaveBeenCalled();
    });

    it('destroys a crashed main window through the captured detach-first path after recovery rebinding', async () => {
        const crashedOwner = createFakeOwnerWindow();
        const windowAliveAtReport: boolean[] = [];
        let harness: Harness;
        const notifyClosed = vi.fn((): Promise<void> => {
            windowAliveAtReport.push(!onlyWindow(harness.windows).isDestroyed());
            return Promise.resolve();
        });
        harness = createHarness({ getParentWindow: () => crashedOwner as never }, notifyClosed);

        const destroyAfterEditorsDetach = bindMainWindowOwnerTeardown(crashedOwner, harness.host);
        expect(destroyAfterEditorsDetach).toBeDefined();

        harness.host.create(request());
        crashedOwner.adopt(onlyWindow(harness.windows));

        const capturedDestroy = destroyAfterEditorsDetach;
        bindMainWindowOwnerTeardown(createFakeOwnerWindow(), harness.host);

        destroyCrashedMainWindow(crashedOwner, capturedDestroy);
        await settled();

        expect(windowAliveAtReport).toEqual([true, false]);
        expect(crashedOwner.isDestroyed()).toBe(true);
        expect(harness.host.exists('plugin-a')).toBe(false);
    });

    it('falls back to platform destroy when crash recovery had no bound host', () => {
        const crashedOwner = createFakeOwnerWindow();

        destroyCrashedMainWindow(crashedOwner, undefined);

        expect(crashedOwner.destroy).toHaveBeenCalledTimes(1);
    });
});
