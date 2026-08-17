/**
 * The JS half of the plugin-window seam, exercised against fake windows.
 *
 * The seam's contracts — parent-or-fallback, close wiring before publication,
 * label lifecycle across open/close/reopen, the off-event-thread notify — are
 * all decisions of `createPluginWindowHost`, so they are testable without an
 * Electron process. What stays untested here is the thin `BaseWindow` factory
 * in `main.ts`, which holds no decisions.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    createPluginWindowHost,
    registerPluginWindowHost,
    type CreateEditorWindowRequest,
    type EditorWindow,
    type EditorWindowOptions,
    type PluginWindowHostDeps,
} from '../pluginGui.js';

type FakeWindow = EditorWindow & {
    readonly emitClosed: () => void;
    readonly options: EditorWindowOptions;
    readonly setContentSize: ReturnType<typeof vi.fn>;
    readonly show: ReturnType<typeof vi.fn>;
    readonly focus: ReturnType<typeof vi.fn>;
    readonly hide: ReturnType<typeof vi.fn>;
    readonly destroy: ReturnType<typeof vi.fn>;
};

const createFakeWindow = (options: EditorWindowOptions): FakeWindow => {
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
        emitClosed,
        getNativeWindowHandle: () => Buffer.alloc(8, 1),
        setContentSize: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        hide: vi.fn(),
        destroy: vi.fn(() => {
            emitClosed();
        }),
        isDestroyed: () => destroyed,
        on: (event, listener) => {
            if (event === 'closed') {
                closedListeners.push(listener);
            }
        },
    };
};

const request = (label = 'plugin-a'): CreateEditorWindowRequest => ({
    label,
    title: 'Surge XT',
    instanceId: 'instance-a',
});

type Harness = {
    readonly host: ReturnType<typeof createPluginWindowHost>;
    readonly windows: FakeWindow[];
    readonly notifyClosed: ReturnType<typeof vi.fn>;
};

const createHarness = (overrides: Partial<PluginWindowHostDeps> = {}): Harness => {
    const windows: FakeWindow[] = [];
    const notifyClosed = vi.fn();
    const host = createPluginWindowHost({
        createWindow: (options) => {
            const window = createFakeWindow(options);
            windows.push(window);
            return window;
        },
        getParentWindow: () => undefined,
        notifyClosed,
        ...overrides,
    });
    return { host, windows, notifyClosed };
};

describe('createPluginWindowHost', () => {
    it('creates a parented window without always-on-top when the DAW window is live', () => {
        const parent = { fake: 'daw-window' } as never;
        const { host, windows } = createHarness({ getParentWindow: () => parent });

        const response = host.create(request());

        expect(response.error).toBeNull();
        expect(response.parented).toBe(true);
        expect(response.handle).toEqual(Buffer.alloc(8, 1));
        expect(windows[0]?.options).toEqual({ title: 'Surge XT', parent, alwaysOnTop: false });
    });

    it('falls back to an unparented always-on-top window when there is no DAW window', () => {
        const { host, windows } = createHarness();

        const response = host.create(request());

        expect(response.error).toBeNull();
        expect(response.parented).toBe(false);
        expect(windows[0]?.options).toEqual({ title: 'Surge XT', parent: undefined, alwaysOnTop: true });
    });

    it('retries unparented when the platform refuses the parent', () => {
        const parent = { fake: 'daw-window' } as never;
        const windows: FakeWindow[] = [];
        let attempts = 0;
        const { host } = createHarness({
            getParentWindow: () => parent,
            createWindow: (options) => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('the platform refused the parent');
                }
                const window = createFakeWindow(options);
                windows.push(window);
                return window;
            },
        });

        const response = host.create(request());

        expect(response.error).toBeNull();
        expect(response.parented).toBe(false);
        expect(windows[0]?.options.alwaysOnTop).toBe(true);
    });

    it('refuses a duplicate label without creating a second window', () => {
        const { host, windows } = createHarness();
        host.create(request());

        const response = host.create(request());

        expect(response.error).toContain('already exists');
        expect(response.handle).toBeNull();
        expect(windows).toHaveLength(1);
    });

    it('answers the existence probe from the live registry', () => {
        const { host } = createHarness();
        expect(host.exists('plugin-a')).toBe(false);

        host.create(request());

        expect(host.exists('plugin-a')).toBe(true);
    });

    it('frees the label and notifies the addon when the OS closes the window, so a reopen works', () => {
        const { host, windows, notifyClosed } = createHarness();
        host.create(request());

        windows[0]?.emitClosed();

        expect(host.exists('plugin-a')).toBe(false);
        expect(notifyClosed).toHaveBeenCalledExactlyOnceWith('instance-a', 'plugin-a');
        expect(host.create(request()).error).toBeNull();
        expect(windows).toHaveLength(2);
    });

    it('supports open, close, reopen across repeated cycles without leaking registrations', () => {
        const { host, windows, notifyClosed } = createHarness();

        for (let cycle = 0; cycle < 3; cycle += 1) {
            expect(host.create(request()).error).toBeNull();
            host.destroy('plugin-a');
            expect(host.exists('plugin-a')).toBe(false);
        }

        expect(windows).toHaveLength(3);
        expect(notifyClosed).toHaveBeenCalledTimes(3);
        for (const window of windows) {
            expect(window.destroy).toHaveBeenCalledTimes(1);
        }
    });

    it('destroys the window and refuses the open when the handle cannot be read', () => {
        const { host, notifyClosed } = createHarness({
            createWindow: (options) => {
                const window = createFakeWindow(options);
                return {
                    ...window,
                    getNativeWindowHandle: () => {
                        throw new Error('no handle');
                    },
                };
            },
        });

        const response = host.create(request());

        expect(response.error).toContain('no handle');
        expect(host.exists('plugin-a')).toBe(false);
        // The destroy fires the closed listener; the reset is idempotent and
        // tolerates a close for a window that was never published.
        expect(notifyClosed).toHaveBeenCalledExactlyOnceWith('instance-a', 'plugin-a');
    });

    it('routes size, focus, hide and show to the labelled window and ignores unknown labels', () => {
        const { host, windows } = createHarness();
        host.create(request());
        const window = windows[0];
        if (window === undefined) {
            throw new Error('expected a window');
        }

        host.setSize({ label: 'plugin-a', width: 1024, height: 768 });
        host.showAndFocus('plugin-a');
        host.hide('plugin-a');
        host.show('plugin-a');
        host.setSize({ label: 'plugin-b', width: 1, height: 1 });
        host.showAndFocus('plugin-b');

        expect(window.setContentSize).toHaveBeenCalledExactlyOnceWith(1024, 768);
        expect(window.focus).toHaveBeenCalledTimes(1);
        expect(window.hide).toHaveBeenCalledTimes(1);
        expect(window.show).toHaveBeenCalledTimes(2);
    });

    it('stops addressing a window once it is destroyed', () => {
        const { host, windows } = createHarness();
        host.create(request());
        host.destroy('plugin-a');

        host.setSize({ label: 'plugin-a', width: 10, height: 10 });
        host.destroy('plugin-a');

        expect(windows[0]?.setContentSize).not.toHaveBeenCalled();
        expect(windows[0]?.destroy).toHaveBeenCalledTimes(1);
    });
});

describe('registerPluginWindowHost', () => {
    it('hands the addon all seven callbacks', () => {
        const register = vi.fn();
        const native = {
            registerPluginWindowHost: register,
            notifyPluginWindowClosed: vi.fn(),
        };

        const registered = registerPluginWindowHost(native, {
            createWindow: createFakeWindow,
            getParentWindow: () => undefined,
        });

        expect(registered).toBe(true);
        expect(register).toHaveBeenCalledTimes(1);
        expect(register.mock.calls[0]).toHaveLength(7);
        for (const callback of register.mock.calls[0] ?? []) {
            expect(typeof callback).toBe('function');
        }
    });

    it('reports the OS close to the addon off the event path when a window closes', () => {
        const register = vi.fn();
        const notify = vi.fn(() => Promise.resolve());
        const native = { registerPluginWindowHost: register, notifyPluginWindowClosed: notify };
        const windows: FakeWindow[] = [];
        registerPluginWindowHost(native, {
            createWindow: (options) => {
                const window = createFakeWindow(options);
                windows.push(window);
                return window;
            },
            getParentWindow: () => undefined,
        });
        const create = register.mock.calls[0]?.[0] as (req: CreateEditorWindowRequest) => unknown;

        create(request());
        windows[0]?.emitClosed();

        expect(notify).toHaveBeenCalledExactlyOnceWith('instance-a', 'plugin-a');
    });

    it('survives an addon built before this packet', () => {
        const registered = registerPluginWindowHost(
            {},
            { createWindow: createFakeWindow, getParentWindow: () => undefined }
        );

        expect(registered).toBe(false);
    });
});
