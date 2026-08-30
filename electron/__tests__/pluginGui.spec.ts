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
    createIntervalRunLoopPump,
    createPluginWindowHost,
    interceptOwnerWindowTeardown,
    OWNER_EDITOR_DETACH_TIMEOUT_MS,
    registerPluginWindowHost,
    type CreateEditorWindowRequest,
    type EditorSize,
    type EditorWindow,
    type EditorWindowBounds,
    type EditorWindowOptions,
    type PluginWindowHost,
    type PluginWindowHostDeps,
    type PreventableEditorEvent,
} from '../pluginGui.js';

type WillResizeListener = (event: PreventableEditorEvent, bounds: EditorWindowBounds) => void;
type CloseListener = (event: PreventableEditorEvent) => void;

type FakeWindow = EditorWindow & {
    /**
     * The platform asks to end this window, as a title-bar click does. Answers
     * whether the host stopped it; an unstopped one destroys the window, which
     * is what the platform would then do.
     */
    readonly emitClose: () => boolean;
    readonly emitClosed: () => void;
    /** The OS applied a resize, as it reports one after the fact. */
    readonly emitResize: () => void;
    /** The user let go of the edge, where the platform reports that. */
    readonly emitResized: () => void;
    readonly emitMoved: () => void;
    /** A drag in progress. Answers whether the host stopped it. */
    readonly emitWillResize: (bounds: EditorWindowBounds) => boolean;
    readonly options: EditorWindowOptions;
    readonly setContentSize: ReturnType<typeof vi.fn<(width: number, height: number) => void>>;
    readonly setResizable: ReturnType<typeof vi.fn<(resizable: boolean) => void>>;
    readonly show: ReturnType<typeof vi.fn<() => void>>;
    readonly showInactive: ReturnType<typeof vi.fn<() => void>>;
    readonly focus: ReturnType<typeof vi.fn<() => void>>;
    readonly hide: ReturnType<typeof vi.fn<() => void>>;
    readonly destroy: ReturnType<typeof vi.fn<() => void>>;
};

const createFakeWindow = (options: EditorWindowOptions): FakeWindow => {
    const closeListeners: CloseListener[] = [];
    const closedListeners: (() => void)[] = [];
    const resizeListeners: (() => void)[] = [];
    const resizedListeners: (() => void)[] = [];
    const movedListeners: (() => void)[] = [];
    const willResizeListeners: WillResizeListener[] = [];
    let destroyed = false;
    let content = { width: 800, height: 600 };
    const emitClosed = (): void => {
        destroyed = true;
        for (const listener of closedListeners) {
            listener();
        }
    };
    // Chromeless, so the frame and the content are the same rectangle: a bare
    // editor window carries no title bar of its own on the platforms that
    // report a drag, and the frame-to-content difference is what a pending drag
    // is converted through.
    const bounds = (): EditorWindowBounds => ({ x: 0, y: 0, ...content });
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
        emitResize: () => {
            for (const listener of resizeListeners) {
                listener();
            }
        },
        emitResized: () => {
            for (const listener of resizedListeners) {
                listener();
            }
        },
        emitMoved: () => {
            for (const listener of movedListeners) {
                listener();
            }
        },
        emitWillResize: (pending) => {
            let prevented = false;
            const event: PreventableEditorEvent = {
                preventDefault: () => {
                    prevented = true;
                },
            };
            for (const listener of willResizeListeners) {
                listener(event, pending);
            }
            return prevented;
        },
        getNativeWindowHandle: () => Buffer.alloc(8, 1),
        setContentSize: vi.fn<(width: number, height: number) => void>((width, height) => {
            content = { width, height };
        }),
        getContentSize: () => [content.width, content.height],
        getBounds: bounds,
        getContentBounds: bounds,
        setResizable: vi.fn<(resizable: boolean) => void>(),
        show: vi.fn<() => void>(),
        showInactive: vi.fn<() => void>(),
        focus: vi.fn<() => void>(),
        hide: vi.fn<() => void>(),
        destroy: vi.fn<() => void>(() => {
            emitClosed();
        }),
        isDestroyed: () => destroyed,
        on: (event: string, listener: (() => void) | CloseListener | WillResizeListener) => {
            if (event === 'will-resize') {
                willResizeListeners.push(listener);
                return;
            }
            if (event === 'close') {
                closeListeners.push(listener as CloseListener);
                return;
            }
            const listeners = {
                closed: closedListeners,
                resize: resizeListeners,
                resized: resizedListeners,
                moved: movedListeners,
            }[event];
            listeners?.push(listener as () => void);
        },
    };
};

/**
 * The DAW window as Electron models a parent: destroying it ends each child
 * with CloseImmediately — `closed` and no preventable `close`.
 */
type FakeOwnerWindow = FakeWindow & {
    readonly adopt: (child: FakeWindow) => void;
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
        destroy: vi.fn<() => void>(() => {
            for (const child of children) {
                if (!child.isDestroyed()) {
                    child.emitClosed();
                }
            }
            destroySelf();
        }),
    };
};

const request = (label = 'plugin-a', instanceId = 'instance-a'): CreateEditorWindowRequest => ({
    label,
    title: 'Surge XT',
    instanceId,
});

/** The deps every registration test supplies, none of which it is about. */
const shellDeps = (
    createWindow: PluginWindowHostDeps['createWindow']
): Omit<PluginWindowHostDeps, 'notifyClosed' | 'runLoopPump' | 'requestEditorSize' | 'applyEditorScale'> => ({
    createWindow,
    getParentWindow: () => undefined,
    getScaleFactor: () => 1,
    watchDisplayChanges: () => {},
});

/** A complete addon surface, so a test only states the member it is about. */
const windowNative = (overrides: Record<string, unknown> = {}): object => ({
    registerPluginWindowHost: vi.fn(),
    notifyPluginWindowClosed: vi.fn(),
    servicePluginEditorRunLoops: vi.fn(),
    resizePluginGui: vi.fn(),
    applyPluginGuiScale: vi.fn(),
    ...overrides,
});

type Harness = {
    readonly host: ReturnType<typeof createPluginWindowHost>;
    readonly windows: FakeWindow[];
    readonly notifyClosed: PluginWindowHostDeps['notifyClosed'];
    readonly requestEditorSize: PluginWindowHostDeps['requestEditorSize'];
    readonly applyEditorScale: PluginWindowHostDeps['applyEditorScale'];
    /** A display was added, removed, or rescaled under every open editor. */
    readonly changeDisplays: () => void;
};

/** The plugin grants every size it is asked for. */
const grantsEverySize = (): PluginWindowHostDeps['requestEditorSize'] =>
    vi.fn((_instanceId: string, width: number, height: number): Promise<EditorSize> =>
        Promise.resolve({ width, height })
    );

const createHarness = (overrides: Partial<PluginWindowHostDeps> = {}): Harness => {
    const windows: FakeWindow[] = [];
    const notifyClosed = overrides.notifyClosed ?? vi.fn((): Promise<void> => Promise.resolve());
    const requestEditorSize = overrides.requestEditorSize ?? grantsEverySize();
    const applyEditorScale =
        overrides.applyEditorScale ?? vi.fn((): Promise<EditorSize> => Promise.resolve({ width: 800, height: 600 }));
    let displaysChanged = (): void => {};
    const host = createPluginWindowHost({
        ...shellDeps((options) => {
            const window = createFakeWindow(options);
            windows.push(window);
            return window;
        }),
        watchDisplayChanges: (onChanged) => {
            displaysChanged = onChanged;
        },
        requestEditorSize,
        applyEditorScale,
        notifyClosed,
        ...overrides,
    });
    return {
        host,
        windows,
        notifyClosed,
        requestEditorSize,
        applyEditorScale,
        changeDisplays: () => {
            displaysChanged();
        },
    };
};

/**
 * Wait for the negotiation a window event started.
 *
 * A resize costs a round trip to the addon, so the window reaches the size the
 * plugin granted a few microtasks after the event that asked for it.
 */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * One whole resize gesture on a platform that reports drags: the user takes an
 * edge, the OS applies the size and says so, and the user lets go.
 */
const dragTo = (window: FakeWindow, size: EditorSize): void => {
    window.emitWillResize({ x: 0, y: 0, ...size });
    window.setContentSize(size.width, size.height);
    window.emitResize();
    window.emitResized();
};

/** The one window a test opened, or a failure that says so. */
const onlyWindow = (windows: FakeWindow[]): FakeWindow => {
    const window = windows[0];
    if (window === undefined) {
        throw new Error('expected a window');
    }
    return window;
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

    it('reports the display scale the window was created at', () => {
        const { host } = createHarness({ getScaleFactor: () => 2 });

        expect(host.create(request()).scaleFactor).toBe(2);
    });

    it('reports an unscaled window when the platform answers a scale nothing can be sized by', () => {
        for (const unusable of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            const { host } = createHarness({ getScaleFactor: () => unusable });

            expect(host.create(request()).scaleFactor).toBe(1);
        }
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

    /**
     * The contract this whole path exists for. Both formats un-parent the
     * plugin's child window from the host's — VST3 `IPlugView::removed`, CLAP
     * `gui.destroy` — so the window they were attached to has to still be there
     * when they run. The platform's own close destroys the window first, which
     * is why it is stopped and re-issued after the teardown.
     */
    it('detaches the plugin while the window is still alive, and destroys it only afterwards', async () => {
        const windowAliveAtReport: boolean[] = [];
        const harness: Harness = createHarness({
            notifyClosed: vi.fn((): Promise<void> => {
                windowAliveAtReport.push(!onlyWindow(harness.windows).isDestroyed());
                return Promise.resolve();
            }),
        });
        harness.host.create(request());
        const window = onlyWindow(harness.windows);

        const stopped = window.emitClose();
        const destroyedInsideTheEvent = window.destroy.mock.calls.length;
        await settled();

        expect(stopped).toBe(true);
        expect(destroyedInsideTheEvent).toBe(0);
        // The teardown that detaches the plugin saw a live window; only the
        // bookkeeping report that follows the destroy saw a dead one.
        expect(windowAliveAtReport).toEqual([true, false]);
        expect(window.destroy).toHaveBeenCalledTimes(1);
        expect(harness.host.exists('plugin-a')).toBe(false);
    });

    /**
     * Parent `destroy()` is CloseImmediately: the child never sees a stoppable
     * `close`, so the title-bar detach path is skipped and the addon's reset
     * runs from `closed` against a window that is already gone. That is the
     * owner-destroy cascade this host has to intercept.
     */
    it('detaches parented editors while they are still alive when the owner is destroyed', async () => {
        const owner = createFakeOwnerWindow();
        const windowAliveAtReport: boolean[] = [];
        const harness: Harness = createHarness({
            getParentWindow: () => owner as never,
            notifyClosed: vi.fn((): Promise<void> => {
                windowAliveAtReport.push(!onlyWindow(harness.windows).isDestroyed());
                return Promise.resolve();
            }),
        });
        const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(owner, () =>
            harness.host.detachOpenEditors()
        );
        harness.host.create(request());
        const editor = onlyWindow(harness.windows);
        owner.adopt(editor);

        await destroyAfterEditorsDetach();

        expect(windowAliveAtReport).toEqual([true, false]);
        expect(editor.isDestroyed()).toBe(true);
        expect(harness.host.exists('plugin-a')).toBe(false);
        expect(owner.isDestroyed()).toBe(true);
        expect(owner.hide).toHaveBeenCalled();
    });

    /**
     * A title-bar close of the DAW window is preventable. Stopping it and
     * destroying only after the editors have left is what keeps that close
     * from becoming CloseImmediately on the children.
     */
    it('stops the owner close, detaches editors, then destroys the owner', async () => {
        const owner = createFakeOwnerWindow();
        const windowAliveAtReport: boolean[] = [];
        const harness: Harness = createHarness({
            getParentWindow: () => owner as never,
            notifyClosed: vi.fn((): Promise<void> => {
                windowAliveAtReport.push(!onlyWindow(harness.windows).isDestroyed());
                return Promise.resolve();
            }),
        });
        interceptOwnerWindowTeardown(owner, () => harness.host.detachOpenEditors());
        harness.host.create(request());
        owner.adopt(onlyWindow(harness.windows));

        const stopped = owner.emitClose();
        const ownerDestroyedInsideTheEvent = owner.isDestroyed();
        await settled();

        expect(stopped).toBe(true);
        expect(ownerDestroyedInsideTheEvent).toBe(false);
        expect(windowAliveAtReport).toEqual([true, false]);
        expect(owner.isDestroyed()).toBe(true);
    });

    it('leaves a cancelled dirty owner close untouched', async () => {
        const owner = createFakeOwnerWindow();
        const detachOpenEditors = vi.fn((): Promise<void> => Promise.resolve());
        interceptOwnerWindowTeardown(owner, detachOpenEditors, () => false);

        const stopped = owner.emitClose();
        await settled();

        expect(stopped).toBe(false);
        expect(detachOpenEditors).not.toHaveBeenCalled();
        expect(owner.hide).not.toHaveBeenCalled();
        expect(owner.destroy).not.toHaveBeenCalled();
    });

    it('restores an owner when close authority changes while editor detach is pending', async () => {
        const owner = createFakeOwnerWindow();
        let proceed = true;
        let firstDetach = true;
        const onCancelled = vi.fn();
        let releaseDetach: (() => void) | undefined;
        const detachOpenEditors = vi.fn(() => {
            if (!firstDetach) {
                return Promise.resolve();
            }
            return new Promise<void>((resolve) => {
                releaseDetach = resolve;
            });
        });
        const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(
            owner,
            detachOpenEditors,
            () => proceed,
            onCancelled
        );

        const teardown = destroyAfterEditorsDetach();
        await settled();
        proceed = false;
        firstDetach = false;
        releaseDetach?.();

        await expect(teardown).resolves.toBe(false);
        expect(owner.destroy).not.toHaveBeenCalled();
        expect(owner.show).toHaveBeenCalledTimes(1);
        expect(onCancelled).toHaveBeenCalledTimes(1);

        proceed = true;
        await expect(destroyAfterEditorsDetach()).resolves.toBe(true);
        expect(owner.destroy).toHaveBeenCalledTimes(1);
    });

    it('upgrades an in-flight close teardown to forced crash destruction', async () => {
        const owner = createFakeOwnerWindow();
        let proceed = true;
        let releaseDetach: (() => void) | undefined;
        const onCancelled = vi.fn();
        const detachOpenEditors = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    releaseDetach = resolve;
                })
        );
        const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(
            owner,
            detachOpenEditors,
            () => proceed,
            onCancelled
        );

        const normalClose = destroyAfterEditorsDetach();
        await settled();
        proceed = false;
        const crashDestroy = destroyAfterEditorsDetach(true);
        releaseDetach?.();

        await expect(Promise.all([normalClose, crashDestroy])).resolves.toEqual([true, true]);
        expect(owner.destroy).toHaveBeenCalledTimes(1);
        expect(owner.show).not.toHaveBeenCalled();
        expect(onCancelled).not.toHaveBeenCalled();
    });

    it.each([
        ['approved close', false],
        ['forced crash', true],
    ])('destroys the hidden owner after a never-settling detach on %s', async (_case, force) => {
        const owner = createFakeOwnerWindow();
        let expireDetach!: () => void;
        const cancelDeadline = vi.fn();
        const timers = {
            setTimer: vi.fn((callback: () => void) => {
                expireDetach = callback;
                return { cancel: cancelDeadline };
            }),
        };
        let rejectDetach!: (error: Error) => void;
        const detachOpenEditors = vi.fn(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectDetach = reject;
                })
        );
        const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(
            owner,
            detachOpenEditors,
            () => true,
            undefined,
            undefined,
            undefined,
            { timers }
        );

        const teardown = destroyAfterEditorsDetach(force);
        await settled();
        expect(owner.hide).toHaveBeenCalledOnce();
        expect(owner.destroy).not.toHaveBeenCalled();
        expect(timers.setTimer).toHaveBeenCalledWith(expect.any(Function), OWNER_EDITOR_DETACH_TIMEOUT_MS);

        expireDetach();
        await expect(teardown).resolves.toBe(true);
        expect(owner.destroy).toHaveBeenCalledOnce();
        expect(owner.isDestroyed()).toBe(true);

        rejectDetach(new Error('late detach failure'));
        await settled();
        expect(owner.destroy).toHaveBeenCalledOnce();
    });

    it.each([
        ['approved', true, false, true],
        ['forced', false, true, true],
        ['authority-invalidated', false, false, false],
    ])('handles a rejected editor detach for %s teardown', async (_case, proceed, force, destroys) => {
        const owner = createFakeOwnerWindow();
        const onCancelled = vi.fn();
        const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(
            owner,
            async () => Promise.reject(new Error('editor detach failed')),
            () => proceed,
            onCancelled
        );

        await expect(destroyAfterEditorsDetach(force)).resolves.toBe(destroys);
        expect(owner.destroy).toHaveBeenCalledTimes(destroys ? 1 : 0);
        expect(owner.show).toHaveBeenCalledTimes(destroys ? 0 : 1);
        expect(onCancelled).toHaveBeenCalledTimes(destroys ? 0 : 1);
    });

    /**
     * Intercepting the owner must not swallow a title-bar close of an editor.
     */
    it('still detaches an editor from its own title-bar close while the owner stays up', async () => {
        const owner = createFakeOwnerWindow();
        const harness = createHarness({ getParentWindow: () => owner as never });
        interceptOwnerWindowTeardown(owner, () => harness.host.detachOpenEditors());
        harness.host.create(request());
        const editor = onlyWindow(harness.windows);

        const stopped = editor.emitClose();
        await settled();

        expect(stopped).toBe(true);
        expect(editor.isDestroyed()).toBe(true);
        expect(harness.host.exists('plugin-a')).toBe(false);
        expect(owner.isDestroyed()).toBe(false);
    });

    it('bounds owner teardown to one detach deadline even with two open editors', async () => {
        vi.useFakeTimers();
        try {
            const owner = createFakeOwnerWindow();
            const harness = createHarness({
                getParentWindow: () => owner as never,
                notifyClosed: vi.fn(() => new Promise<void>(() => {})),
            });
            interceptOwnerWindowTeardown(owner, () => harness.host.detachOpenEditors());
            harness.host.create(request('plugin-a', 'instance-a'));
            harness.host.create(request('plugin-b', 'instance-b'));
            for (const window of harness.windows) {
                owner.adopt(window);
            }

            const stopped = owner.emitClose();
            await vi.advanceTimersByTimeAsync(4_999);
            const destroyedBeforeTheDeadline = owner.isDestroyed();
            await vi.advanceTimersByTimeAsync(1);

            expect(stopped).toBe(true);
            expect(destroyedBeforeTheDeadline).toBe(false);
            expect(owner.isDestroyed()).toBe(true);
            expect(harness.windows.every((window) => window.isDestroyed())).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * `detachOpenEditors` snapshots labels once. A create that parents to the
     * still-live owner during that await would miss the drain and then take
     * CloseImmediately from `owner.destroy()` — notifyClosed against a dead
     * window. Refuse create against an owner already in teardown instead.
     */
    it('refuses create against an owner already tearing down', async () => {
        const owner = createFakeOwnerWindow();
        let releaseFirstDetach: () => void = () => {};
        const firstDetachHeld = new Promise<void>((resolve) => {
            releaseFirstDetach = resolve;
        });
        const lateAliveAtNotify: boolean[] = [];
        const harness: Harness = createHarness({
            getParentWindow: () => owner as never,
            notifyClosed: vi.fn((_instanceId: string, label: string): Promise<void> => {
                if (label === 'plugin-b') {
                    const late = harness.windows[1];
                    if (late !== undefined) {
                        lateAliveAtNotify.push(!late.isDestroyed());
                    }
                }
                if (label === 'plugin-a') {
                    return firstDetachHeld;
                }
                return Promise.resolve();
            }),
        });
        const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(owner, () =>
            harness.host.detachOpenEditors()
        );
        harness.host.create(request('plugin-a', 'instance-a'));
        owner.adopt(onlyWindow(harness.windows));

        const teardown = destroyAfterEditorsDetach();
        await settled();

        const late = harness.host.create(request('plugin-b', 'instance-b'));
        expect(late.error).toMatch(/tearing down/i);
        expect(harness.host.exists('plugin-b')).toBe(false);

        releaseFirstDetach();
        await teardown;

        expect(lateAliveAtNotify).toEqual([]);
        expect(owner.isDestroyed()).toBe(true);
    });

    /**
     * Crash recovery rebinds getParentWindow to the replacement. Creates during
     * the crashed owner's detach must parent there and survive its destroy.
     */
    it('creates against a replacement owner while a crashed owner is tearing down', async () => {
        const crashedOwner = createFakeOwnerWindow();
        const replacementOwner = createFakeOwnerWindow();
        let parent: FakeOwnerWindow = crashedOwner;
        let releaseFirstDetach: () => void = () => {};
        const firstDetachHeld = new Promise<void>((resolve) => {
            releaseFirstDetach = resolve;
        });
        const harness: Harness = createHarness({
            getParentWindow: () => parent as never,
            notifyClosed: vi.fn((_instanceId: string, label: string): Promise<void> => {
                if (label === 'plugin-a') {
                    return firstDetachHeld;
                }
                return Promise.resolve();
            }),
        });
        const { destroyAfterEditorsDetach } = interceptOwnerWindowTeardown(crashedOwner, () =>
            harness.host.detachOpenEditors()
        );
        harness.host.create(request('plugin-a', 'instance-a'));
        crashedOwner.adopt(onlyWindow(harness.windows));

        const teardown = destroyAfterEditorsDetach();
        await settled();

        parent = replacementOwner;
        interceptOwnerWindowTeardown(replacementOwner, () => harness.host.detachOpenEditors());

        const late = harness.host.create(request('plugin-b', 'instance-b'));
        expect(late.error).toBeNull();
        expect(late.parented).toBe(true);
        const lateEditor = harness.windows[1];
        if (lateEditor === undefined) {
            throw new Error('expected the replacement-parented editor');
        }
        replacementOwner.adopt(lateEditor);

        releaseFirstDetach();
        await teardown;

        expect(harness.host.exists('plugin-b')).toBe(true);
        expect(lateEditor.isDestroyed()).toBe(false);
        expect(crashedOwner.isDestroyed()).toBe(true);
        expect(replacementOwner.isDestroyed()).toBe(false);
    });

    /**
     * The stop must not be visible. The teardown's plugin call is carried back
     * to this thread, so a window left on screen for it is a frozen editor for
     * as long as the plugin takes — where the platform's own close made it
     * vanish on the click.
     */
    it('hides the window as it stops the close, before the teardown is asked for', async () => {
        const seen: { hidden: boolean; destroyed: boolean }[] = [];
        const harness: Harness = createHarness({
            notifyClosed: vi.fn((): Promise<void> => {
                const window = onlyWindow(harness.windows);
                seen.push({ hidden: window.hide.mock.calls.length > 0, destroyed: window.isDestroyed() });
                return Promise.resolve();
            }),
        });
        harness.host.create(request());
        const window = onlyWindow(harness.windows);

        window.emitClose();
        const hiddenInsideTheEvent = window.hide.mock.calls.length;
        await settled();

        expect(hiddenInsideTheEvent).toBe(1);
        // The teardown was asked for against a window that was already off
        // screen and still very much alive.
        expect(seen[0]).toEqual({ hidden: true, destroyed: false });
        expect(window.destroy).toHaveBeenCalledTimes(1);
    });

    /**
     * A window held open for its teardown still raises everything a window
     * raises. Each of those would claim the engine control gate the teardown is
     * waiting on, against a plugin that is already inside `close_gui`.
     */
    it('asks the plugin nothing while its window is held open for the teardown', async () => {
        vi.useFakeTimers();
        try {
            let scale = 1;
            const harness = createHarness({
                getScaleFactor: () => scale,
                notifyClosed: vi.fn(() => new Promise<void>(() => {})),
            });
            harness.host.create(request());
            const window = onlyWindow(harness.windows);

            window.emitClose();
            window.setContentSize(1000, 900);
            window.emitResize();
            window.emitResized();
            window.emitWillResize({ x: 0, y: 0, width: 1200, height: 1000 });
            scale = 2;
            window.emitMoved();
            harness.changeDisplays();
            await vi.advanceTimersByTimeAsync(200);

            expect(harness.requestEditorSize).not.toHaveBeenCalled();
            expect(harness.applyEditorScale).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * The deadline is armed on every stopped close and fires on almost none of
     * them. One left behind per close is a five-second timer holding the Node
     * loop open for a window that is already gone.
     */
    it('leaves no deadline timer behind when the plugin lets go inside it', async () => {
        vi.useFakeTimers();
        try {
            const harness = createHarness();
            harness.host.create(request());
            const window = onlyWindow(harness.windows);

            window.emitClose();
            await vi.advanceTimersByTimeAsync(1);

            expect(window.destroy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * The destroy that ends a stopped close raises `closed`, and that path still
     * reports. The addon's reset is idempotent — the second report finds the
     * record already gone — and keeping it is what covers a window the platform
     * destroys outright, with no close to stop.
     */
    it('still reports the closed window after the teardown that stopped its close', async () => {
        const harness = createHarness();
        harness.host.create(request());

        onlyWindow(harness.windows).emitClose();
        await settled();

        expect(harness.notifyClosed).toHaveBeenCalledTimes(2);
        expect(harness.notifyClosed).toHaveBeenNthCalledWith(1, 'instance-a', 'plugin-a');
        expect(harness.notifyClosed).toHaveBeenNthCalledWith(2, 'instance-a', 'plugin-a');
    });

    /**
     * A stopped close that never got un-stopped is an editor the user cannot
     * close, which is worse than a teardown that missed its parent.
     */
    it('destroys the window anyway when the plugin teardown fails', async () => {
        const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const harness = createHarness({
                notifyClosed: vi.fn(() => Promise.reject(new Error('the plugin never let go'))),
            });
            harness.host.create(request());
            const window = onlyWindow(harness.windows);

            window.emitClose();
            await settled();

            expect(window.destroy).toHaveBeenCalledTimes(1);
            expect(harness.host.exists('plugin-a')).toBe(false);
            expect(reported).toHaveBeenCalledWith(expect.stringContaining('the plugin never let go'));
        } finally {
            reported.mockRestore();
        }
    });

    it('destroys the window at the deadline when the plugin teardown never answers', async () => {
        vi.useFakeTimers();
        try {
            const harness = createHarness({ notifyClosed: vi.fn(() => new Promise<void>(() => {})) });
            harness.host.create(request());
            const window = onlyWindow(harness.windows);

            window.emitClose();
            await vi.advanceTimersByTimeAsync(4_999);
            const destroyedBeforeTheDeadline = window.destroy.mock.calls.length;
            await vi.advanceTimersByTimeAsync(1);

            expect(destroyedBeforeTheDeadline).toBe(0);
            expect(window.destroy).toHaveBeenCalledTimes(1);
            expect(harness.host.exists('plugin-a')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * A user whose editor did not disappear clicks the title bar again. The
     * second close must not start a second teardown, and must not let the
     * platform destroy the window out from under the first one.
     */
    it('stops a second OS close during a teardown without running the teardown twice', async () => {
        let letGo = (): void => {};
        const notifyClosed = vi.fn(
            (): Promise<void> =>
                new Promise<void>((resolve) => {
                    letGo = resolve;
                })
        );
        const harness = createHarness({ notifyClosed });
        harness.host.create(request());
        const window = onlyWindow(harness.windows);

        expect(window.emitClose()).toBe(true);
        expect(window.emitClose()).toBe(true);
        expect(notifyClosed).toHaveBeenCalledTimes(1);
        expect(window.destroy).not.toHaveBeenCalled();

        letGo();
        await settled();

        expect(window.destroy).toHaveBeenCalledTimes(1);
    });

    /**
     * The command path detaches in the backend before it ever addresses the
     * window host, so the host's `destroy` is the immediate end of the window it
     * has always been. Routing it through the OS-close teardown would tear the
     * editor down twice.
     */
    it('destroys a window the backend closes without waiting for a teardown', () => {
        const harness = createHarness();
        harness.host.create(request());
        const window = onlyWindow(harness.windows);

        harness.host.destroy('plugin-a');

        expect(window.destroy).toHaveBeenCalledTimes(1);
        expect(harness.host.exists('plugin-a')).toBe(false);
        expect(harness.notifyClosed).toHaveBeenCalledExactlyOnceWith('instance-a', 'plugin-a');
    });

    /** A plugin on its way out of a window is not asked what size to be. */
    it('drops a pending size settle when the OS asks to close the window', async () => {
        vi.useFakeTimers();
        try {
            const harness = createHarness({ notifyClosed: vi.fn(() => new Promise<void>(() => {})) });
            harness.host.create(request());
            const window = onlyWindow(harness.windows);
            window.setContentSize(1000, 900);
            window.emitResize();

            window.emitClose();
            await vi.advanceTimersByTimeAsync(200);

            expect(harness.requestEditorSize).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
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

    it('fails the open cleanly when the platform cannot create any window', () => {
        // The outer catch in `create` is what turns a factory throw into a
        // failed open instead of an uncaught main-process exception plus a
        // Rust worker parked on the full deadline.
        const { host } = createHarness({
            createWindow: () => {
                throw new Error('no window system');
            },
        });

        const response = host.create(request());

        expect(response.error).toContain('no window system');
        expect(response.handle).toBeNull();
        expect(host.exists('plugin-a')).toBe(false);
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
        expect(window.show).toHaveBeenCalledTimes(1);
        // The label-addressed show is focus-free, matching the seam's
        // `show_window`; only `showAndFocus` may steal focus.
        expect(window.showInactive).toHaveBeenCalledTimes(1);
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

    it('runs the plugin run loop only while an editor is open', () => {
        const runLoopPump = { start: vi.fn(), stop: vi.fn() };
        const { host } = createHarness({ runLoopPump });

        expect(runLoopPump.start).not.toHaveBeenCalled();

        host.create(request('plugin-a'));
        host.create(request('plugin-b'));
        expect(runLoopPump.start).toHaveBeenCalled();
        expect(runLoopPump.stop).not.toHaveBeenCalled();

        host.destroy('plugin-a');
        expect(runLoopPump.stop).not.toHaveBeenCalled();

        host.destroy('plugin-b');
        expect(runLoopPump.stop).toHaveBeenCalledTimes(1);
    });

    it('stops the run loop when the OS closes the last editor behind the host', () => {
        const runLoopPump = { start: vi.fn(), stop: vi.fn() };
        const { host, windows } = createHarness({ runLoopPump });
        host.create(request());

        windows[0]?.emitClosed();

        expect(runLoopPump.stop).toHaveBeenCalledTimes(1);
    });

    it('lets the user drag only the editors whose plugin accepts a host-chosen size', () => {
        const { host, windows } = createHarness();
        host.create(request('plugin-a'));
        host.create(request('plugin-b', 'instance-b'));
        const [resizable, fixed] = windows;

        host.setResizable({ label: 'plugin-a', resizable: true });
        host.setResizable({ label: 'plugin-b', resizable: false });
        host.setResizable({ label: 'plugin-c', resizable: true });

        expect(resizable?.setResizable).toHaveBeenCalledExactlyOnceWith(true);
        expect(fixed?.setResizable).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('asks the plugin what it will run at when the user drags the window, and lands on that answer', async () => {
        const requestEditorSize = vi.fn(() => Promise.resolve({ width: 640, height: 480 }));
        const { host, windows } = createHarness({ requestEditorSize });
        host.create(request());
        const window = onlyWindow(windows);

        dragTo(window, { width: 1000, height: 900 });
        await settled();

        expect(requestEditorSize).toHaveBeenCalledExactlyOnceWith('instance-a', 1000, 900);
        expect(window.getContentSize()).toEqual([640, 480]);
    });

    it('leaves the window where the drag put it when the plugin grants that size', async () => {
        const { host, windows, requestEditorSize } = createHarness();
        host.create(request());
        const window = onlyWindow(windows);

        dragTo(window, { width: 1000, height: 900 });
        await settled();

        expect(requestEditorSize).toHaveBeenCalledExactlyOnceWith('instance-a', 1000, 900);
        expect(window.getContentSize()).toEqual([1000, 900]);
    });

    /**
     * Every answer costs the audio host's control claim, held across a hop to
     * this thread, and an instance whose block lands inside a claim emits
     * nothing. One question per `resize` event would hold that claim end to end
     * for the length of a drag and mute the instrument while the user resizes
     * it.
     */
    it('asks the plugin nothing while the pointer is still down', async () => {
        vi.useFakeTimers();
        try {
            const { host, windows, requestEditorSize } = createHarness();
            host.create(request());
            const window = onlyWindow(windows);

            for (const width of [820, 840, 860, 880]) {
                window.emitWillResize({ x: 0, y: 0, width, height: 600 });
                window.setContentSize(width, 600);
                window.emitResize();
                await vi.advanceTimersByTimeAsync(300);
            }
            expect(requestEditorSize).not.toHaveBeenCalled();

            window.emitResized();
            await vi.advanceTimersByTimeAsync(0);

            expect(requestEditorSize).toHaveBeenCalledExactlyOnceWith('instance-a', 880, 600);
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * A maximise, a title-bar zoom and a keyboard snap all resize the window
     * without a drag, so no commit is coming: `will-resize` never fires, and
     * `resized` belongs to the live-resize loop that never ran. Waiting for one
     * leaves the editor drawing at its old size in the corner of the new frame
     * for as long as the window stays maximised. It is also the whole of what
     * X11 offers, where a drag reports neither event.
     */
    it('negotiates a size change that arrives with no gesture behind it', async () => {
        vi.useFakeTimers();
        try {
            const { host, windows, requestEditorSize } = createHarness();
            host.create(request());
            const window = onlyWindow(windows);

            window.setContentSize(1440, 900);
            window.emitResize();
            await vi.advanceTimersByTimeAsync(100);
            expect(requestEditorSize).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(200);

            expect(requestEditorSize).toHaveBeenCalledExactlyOnceWith('instance-a', 1440, 900);
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * The pause is restarted by each size change, so a window still moving is
     * never negotiated. A settle that only ever added timers would ask about
     * every size the window passed through, one stale answer per timer.
     */
    it('asks about where the window stopped, not where it was when the pause started', async () => {
        vi.useFakeTimers();
        try {
            const asked: EditorSize[] = [];
            const requestEditorSize = vi.fn((_instanceId: string, width: number, height: number) => {
                asked.push({ width, height });
                return Promise.resolve({ width, height });
            });
            const { host, windows } = createHarness({ requestEditorSize });
            host.create(request());
            const window = onlyWindow(windows);

            for (const width of [900, 930, 860]) {
                window.setContentSize(width, 600);
                window.emitResize();
                await vi.advanceTimersByTimeAsync(150);
            }
            expect(asked).toEqual([]);

            await vi.advanceTimersByTimeAsync(200);

            expect(asked).toEqual([{ width: 860, height: 600 }]);
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * The plugin's own resize arrives through `setSize` and raises the same
     * events a gesture does. Putting it back to the plugin as a host request is
     * a loop that never settles.
     */
    it('does not put the plugin its own resize back as a host-chosen size', async () => {
        vi.useFakeTimers();
        try {
            const { host, windows, requestEditorSize } = createHarness();
            host.create(request());
            const window = onlyWindow(windows);

            host.setSize({ label: 'plugin-a', width: 500, height: 400 });
            window.emitResize();
            // Past the settle the echo arms: no gesture stands behind a size
            // the plugin chose, so it takes the same path a maximise does and
            // is stopped by the size already granted rather than by the event.
            await vi.advanceTimersByTimeAsync(300);

            expect(requestEditorSize).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * A second gesture can commit while the plugin is still answering the
     * first, and only the size the window is at now is worth asking about.
     */
    it('asks about the size the window ended at, not every gesture it passed through', async () => {
        const asked: number[] = [];
        let grant = (_size: EditorSize): void => {};
        const requestEditorSize = vi.fn((_instanceId: string, width: number, _height: number) => {
            asked.push(width);
            return new Promise<EditorSize>((resolve) => {
                grant = resolve;
            });
        });
        const { host, windows } = createHarness({ requestEditorSize });
        host.create(request());
        const window = onlyWindow(windows);

        dragTo(window, { width: 900, height: 700 });
        for (const width of [910, 920, 930]) {
            dragTo(window, { width, height: 700 });
        }
        grant({ width: 900, height: 700 });
        await settled();
        grant({ width: 930, height: 700 });
        await settled();

        expect(asked).toEqual([900, 930]);
    });

    /**
     * The window ending back at a size the plugin already granted is still news
     * while an older answer is in flight: that answer is about to put its own
     * size on the window, and only a queued entry brings it back.
     */
    it('answers with the size the window is at when one arrives mid-negotiation', async () => {
        const asked: number[] = [];
        const grants: (() => void)[] = [];
        const requestEditorSize = vi.fn(
            (_instanceId: string, width: number, height: number) =>
                new Promise<EditorSize>((resolve) => {
                    asked.push(width);
                    grants.push(() => {
                        resolve({ width, height });
                    });
                })
        );
        const { host, windows } = createHarness({ requestEditorSize });
        host.create(request());
        const window = onlyWindow(windows);

        dragTo(window, { width: 900, height: 700 });
        grants.shift()?.();
        await settled();

        dragTo(window, { width: 1000, height: 700 });
        dragTo(window, { width: 900, height: 700 });
        grants.shift()?.();
        await settled();
        grants.shift()?.();
        await settled();

        expect(asked).toEqual([900, 1000, 900]);
        expect(window.getContentSize()).toEqual([900, 700]);
    });

    it('stops a drag back through a size the plugin already refused', async () => {
        const { host, windows } = createHarness({
            requestEditorSize: vi.fn(() => Promise.resolve({ width: 640, height: 480 })),
        });
        host.create(request());
        const window = onlyWindow(windows);
        dragTo(window, { width: 1000, height: 900 });
        await settled();

        const prevented = window.emitWillResize({ x: 0, y: 0, width: 1000, height: 900 });

        expect(prevented).toBe(true);
        expect(window.getContentSize()).toEqual([640, 480]);
    });

    it('lets a drag to any other size through, because only the plugin can judge it', async () => {
        const { host, windows } = createHarness({
            requestEditorSize: vi.fn(() => Promise.resolve({ width: 640, height: 480 })),
        });
        host.create(request());
        const window = onlyWindow(windows);
        dragTo(window, { width: 1000, height: 900 });
        await settled();

        expect(window.emitWillResize({ x: 0, y: 0, width: 700, height: 500 })).toBe(false);
    });

    /**
     * A plugin that later picks the very size it once refused — from its own
     * zoom menu, through `request_resize` — has settled the argument. A veto
     * kept past that snaps the window back off the size the plugin is now
     * drawing at.
     */
    it('stops vetoing a size the plugin has since chosen for itself', async () => {
        const { host, windows } = createHarness({
            requestEditorSize: vi.fn(() => Promise.resolve({ width: 640, height: 480 })),
        });
        host.create(request());
        const window = onlyWindow(windows);
        dragTo(window, { width: 1000, height: 900 });
        await settled();

        host.setSize({ label: 'plugin-a', width: 1000, height: 900 });

        expect(window.emitWillResize({ x: 0, y: 0, width: 1000, height: 900 })).toBe(false);
        expect(window.getContentSize()).toEqual([1000, 900]);
    });

    it('tells an editor dragged onto a denser display its new scale and takes the size that produced', async () => {
        let scale = 1;
        const applyEditorScale = vi.fn(() => Promise.resolve({ width: 1280, height: 960 }));
        const { host, windows } = createHarness({ getScaleFactor: () => scale, applyEditorScale });
        host.create(request());
        const window = onlyWindow(windows);

        window.emitMoved();
        await settled();
        expect(applyEditorScale).not.toHaveBeenCalled();

        scale = 2;
        window.emitMoved();
        await settled();

        expect(applyEditorScale).toHaveBeenCalledExactlyOnceWith('instance-a', 2);
        expect(window.getContentSize()).toEqual([1280, 960]);
    });

    /**
     * A hop to the plugin can fail — a busy editor, or the UI-thread deadline
     * expiring. Treating the attempt as the state would leave the editor at the
     * old density permanently, because every later event finds the new scale
     * already recorded and asks nothing.
     */
    it('tells the editor its density again after an attempt the plugin refused', async () => {
        let scale = 1;
        let refuse = true;
        const applyEditorScale = vi.fn(() =>
            refuse ? Promise.reject(new Error('the editor is busy')) : Promise.resolve({ width: 1280, height: 960 })
        );
        const { host, windows } = createHarness({ getScaleFactor: () => scale, applyEditorScale });
        host.create(request());
        const window = onlyWindow(windows);

        scale = 2;
        window.emitMoved();
        await settled();
        expect(applyEditorScale).toHaveBeenCalledTimes(1);

        refuse = false;
        window.emitMoved();
        await settled();

        expect(applyEditorScale.mock.calls).toEqual([
            ['instance-a', 2],
            ['instance-a', 2],
        ]);
        expect(window.getContentSize()).toEqual([1280, 960]);
    });

    it('restates the scale on every open editor when the displays themselves change', async () => {
        let scale = 1;
        const applyEditorScale = vi.fn(() => Promise.resolve({ width: 1280, height: 960 }));
        const { host, changeDisplays } = createHarness({ getScaleFactor: () => scale, applyEditorScale });
        host.create(request('plugin-a', 'instance-a'));
        host.create(request('plugin-b', 'instance-b'));

        scale = 2;
        changeDisplays();
        await settled();

        expect(applyEditorScale.mock.calls).toEqual([
            ['instance-a', 2],
            ['instance-b', 2],
        ]);
    });

    it('keeps the editor open when the plugin refuses a host resize', async () => {
        const { host, windows } = createHarness({
            requestEditorSize: vi.fn(() => Promise.reject(new Error('the editor is busy'))),
        });
        host.create(request());
        const window = onlyWindow(windows);

        dragTo(window, { width: 1000, height: 900 });
        await settled();

        expect(host.exists('plugin-a')).toBe(true);
        expect(window.isDestroyed()).toBe(false);
    });
});

describe('createIntervalRunLoopPump', () => {
    it('keeps one timer across repeated starts and releases it on stop', () => {
        vi.useFakeTimers();
        try {
            const service = vi.fn();
            const pump = createIntervalRunLoopPump(service, 16);

            pump.start();
            pump.start();
            vi.advanceTimersByTime(48);
            expect(service).toHaveBeenCalledTimes(3);

            pump.stop();
            vi.advanceTimersByTime(48);
            expect(service).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('registerPluginWindowHost', () => {
    it('hands the addon the eight callbacks in the order it consumes them', () => {
        // Four of the callbacks share the type `(label: string) => void`, so a
        // transposition typechecks; each slot is therefore driven by index and
        // pinned to its discriminating effect on the window.
        const register = vi.fn();
        const windows: FakeWindow[] = [];
        const registered = registerPluginWindowHost(
            windowNative({ registerPluginWindowHost: register }),
            shellDeps((options) => {
                const window = createFakeWindow(options);
                windows.push(window);
                return window;
            })
        );
        expect(registered).toBeDefined();
        expect(register.mock.calls[0]).toHaveLength(8);
        const [create, exists, setSize, setResizable, showAndFocus, destroy, hide, show] = (register.mock.calls[0] ??
            []) as [
            PluginWindowHost['create'],
            PluginWindowHost['exists'],
            PluginWindowHost['setSize'],
            PluginWindowHost['setResizable'],
            PluginWindowHost['showAndFocus'],
            PluginWindowHost['destroy'],
            PluginWindowHost['hide'],
            PluginWindowHost['show'],
        ];

        expect(create(request()).error).toBeNull();
        const window = onlyWindow(windows);
        expect(exists('plugin-a')).toBe(true);

        setSize({ label: 'plugin-a', width: 640, height: 480 });
        expect(window.setContentSize).toHaveBeenCalledExactlyOnceWith(640, 480);

        setResizable({ label: 'plugin-a', resizable: true });
        expect(window.setResizable).toHaveBeenCalledExactlyOnceWith(true);

        showAndFocus('plugin-a');
        expect(window.show).toHaveBeenCalledTimes(1);
        expect(window.focus).toHaveBeenCalledTimes(1);

        hide('plugin-a');
        expect(window.hide).toHaveBeenCalledTimes(1);

        show('plugin-a');
        expect(window.showInactive).toHaveBeenCalledTimes(1);
        expect(window.show).toHaveBeenCalledTimes(1);

        destroy('plugin-a');
        expect(window.destroy).toHaveBeenCalledTimes(1);
        expect(exists('plugin-a')).toBe(false);
    });

    it('reports the OS close to the addon off the event path when a window closes', () => {
        const register = vi.fn();
        const notify = vi.fn(() => Promise.resolve());
        const native = windowNative({
            registerPluginWindowHost: register,
            notifyPluginWindowClosed: notify,
        });
        const windows: FakeWindow[] = [];
        registerPluginWindowHost(
            native,
            shellDeps((options) => {
                const window = createFakeWindow(options);
                windows.push(window);
                return window;
            })
        );
        const create = register.mock.calls[0]?.[0] as (req: CreateEditorWindowRequest) => unknown;

        create(request());
        windows[0]?.emitClosed();

        expect(notify).toHaveBeenCalledExactlyOnceWith('instance-a', 'plugin-a');
    });

    /**
     * The addon method is async, and its promise is what the stopped close waits
     * on. A registration that dropped it would destroy the window in the same
     * turn as the report, which is the platform behaviour the stop exists to
     * replace.
     */
    it('holds a window the OS asked to close until the addon answers', async () => {
        const register = vi.fn();
        let answered = (): void => {};
        const notify = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    answered = resolve;
                })
        );
        const windows: FakeWindow[] = [];
        registerPluginWindowHost(
            windowNative({ registerPluginWindowHost: register, notifyPluginWindowClosed: notify }),
            shellDeps((options) => {
                const window = createFakeWindow(options);
                windows.push(window);
                return window;
            })
        );
        const create = register.mock.calls[0]?.[0] as (req: CreateEditorWindowRequest) => unknown;
        create(request());
        const window = onlyWindow(windows);

        window.emitClose();
        await settled();
        const destroyedWhileWaiting = window.destroy.mock.calls.length;
        answered();
        await settled();

        expect(destroyedWhileWaiting).toBe(0);
        expect(window.destroy).toHaveBeenCalledTimes(1);
    });

    it('survives an addon built before this packet', () => {
        const registered = registerPluginWindowHost({}, shellDeps(createFakeWindow));

        expect(registered).toBeUndefined();
    });

    /**
     * A window whose edges the user can drag is only safe once the addon can be
     * asked what the plugin will run at. Registering against a binary that
     * carries the window seam but not the resize commands would open editors
     * whose every drag lands on a missing method.
     */
    it('refuses an addon that carries the window seam without the resize commands', () => {
        for (const missing of ['resizePluginGui', 'applyPluginGuiScale']) {
            const native = windowNative();
            Reflect.deleteProperty(native, missing);

            expect(registerPluginWindowHost(native, shellDeps(createFakeWindow))).toBeUndefined();
        }
    });

    /**
     * Runs `run` with `process.platform` reporting `platform`, and puts the
     * real one back. The platform gate is read at registration, and nothing
     * else in the shell can be asked what it decided.
     */
    const withPlatform = <Answer>(platform: NodeJS.Platform, run: () => Answer): Answer => {
        const real = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: platform, configurable: true });
        try {
            return run();
        } finally {
            if (real !== undefined) {
                Object.defineProperty(process, 'platform', real);
            }
        }
    };

    /** How many run-loop passes one open editor draws on this platform. */
    const runLoopPassesWhileAnEditorIsOpen = (platform: NodeJS.Platform): number => {
        const serviceRunLoops = vi.fn(() => 0);
        const register = vi.fn();
        withPlatform(platform, () =>
            registerPluginWindowHost(
                windowNative({
                    registerPluginWindowHost: register,
                    servicePluginEditorRunLoops: serviceRunLoops,
                }),
                shellDeps(createFakeWindow)
            )
        );
        const create = register.mock.calls[0]?.[0] as (req: CreateEditorWindowRequest) => unknown;

        create(request());
        vi.advanceTimersByTime(64);

        return serviceRunLoops.mock.calls.length;
    };

    /**
     * VST3 defines `IRunLoop` for Linux alone; everywhere else the OS toolkit
     * the shell already runs dispatches the plugin's own events. A shell that
     * pumped regardless would call into the addon 60 times a second for nothing,
     * and one that never pumped would leave a Linux editor unable to draw or
     * take input. Every other test injects the pump directly, so this is the
     * only place the gate itself is read.
     */
    it('drives a plugin editor run loop only on the platform whose format defines one', () => {
        vi.useFakeTimers();
        try {
            expect(runLoopPassesWhileAnEditorIsOpen('linux')).toBeGreaterThan(0);
            expect(runLoopPassesWhileAnEditorIsOpen('darwin')).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('refuses an addon that carries the window seam without the run-loop pump', () => {
        const register = vi.fn();
        const native = windowNative({ registerPluginWindowHost: register });
        Reflect.deleteProperty(native, 'servicePluginEditorRunLoops');

        const registered = registerPluginWindowHost(native, shellDeps(createFakeWindow));

        expect(registered).toBeUndefined();
        expect(register).not.toHaveBeenCalled();
    });
});
