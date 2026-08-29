/**
 * Native plugin editor windows for the Electron shell (packet T-4).
 *
 * The addon owns every decision about a plugin editor — whether it may open,
 * the CLAP lifecycle, the bookkeeping, the close/hide/show semantics. This
 * module only knows how to make a bare native window on this platform: it is
 * the JS half of the `PluginWindowHost` seam, registered as
 * threadsafe-function callbacks at startup.
 *
 * Two contracts from that seam are load-bearing here:
 *
 * - The editor window is *owned* by the DAW window when the platform allows
 *   it; `alwaysOnTop` is only the fallback that keeps an unparented editor
 *   reachable. Ownership is a destruction cascade as well as a z-order
 *   relationship, so no other window may ever become the parent.
 * - When the OS ends an editor window — title-bar close, or the owner-destroy
 *   cascade — the addon's reset must run *off* this event path. The notify
 *   call is an async napi method, so it only schedules work on the addon's
 *   executor; running the reset inline on the main thread is the documented
 *   deadlock with GUI-affine plugins.
 * - A plugin editor's own event loop, where the format has one the host drives,
 *   belongs to the thread that owns the window. That is this thread, so the
 *   pump runs here, and only while an editor is open.
 *
 * The window registry lives here, in the `editors` map, and nowhere else: the
 * addon probes and addresses windows by label through the callbacks, so a
 * label is free again the moment the platform reports the window closed.
 */
import type { BaseWindow } from 'electron';

export type CreateEditorWindowRequest = {
    readonly label: string;
    readonly title: string;
    readonly instanceId: string;
};

/** What `create` answers the addon: a handle, or a reason. */
export type CreateEditorWindowResponse = {
    readonly handle: Buffer | null;
    readonly parented: boolean;
    /**
     * The display scale the window was created at. The shell is the only side
     * that can measure it, and a plugin whose editor rect is in physical pixels
     * — VST3 on Windows and X11 — cannot be sized correctly without it.
     */
    readonly scaleFactor: number;
    readonly error: string | null;
};

export type EditorWindowSizeRequest = {
    readonly label: string;
    readonly width: number;
    readonly height: number;
};

/** What the factory decides per window; everything else is fixed policy. */
export type EditorWindowOptions = {
    readonly title: string;
    readonly parent: BaseWindow | undefined;
    readonly alwaysOnTop: boolean;
};

/** The slice of `BaseWindow` this module touches, injectable for the specs. */
export type EditorWindow = {
    readonly getNativeWindowHandle: () => Buffer;
    readonly setContentSize: (width: number, height: number) => void;
    readonly show: () => void;
    readonly showInactive: () => void;
    readonly focus: () => void;
    readonly hide: () => void;
    readonly destroy: () => void;
    readonly isDestroyed: () => boolean;
    readonly on: (event: 'closed', listener: () => void) => unknown;
};

/**
 * Drives a plugin format's own event loop on this thread.
 *
 * The VST3 `IRunLoop` a Linux plugin registers its X11 handlers and timers with
 * is the host's to dispatch, and it must be dispatched on the thread that owns
 * the editor window — this one. It runs only while an editor is open, because
 * with none open there is nothing registered to dispatch.
 */
export type EditorRunLoopPump = {
    readonly start: () => void;
    readonly stop: () => void;
};

export type PluginWindowHostDeps = {
    readonly createWindow: (options: EditorWindowOptions) => EditorWindow;
    /** The live DAW window, re-read per create because it is replaced on a renderer crash. */
    readonly getParentWindow: () => BaseWindow | undefined;
    /** The scale of the display the editor window is created on. */
    readonly getScaleFactor: () => number;
    /** Reports an OS-level close to the addon. Must only schedule, never block. */
    readonly notifyClosed: (instanceId: string, label: string) => void;
    /** Absent where no hosted format needs a host-driven run loop. */
    readonly runLoopPump?: EditorRunLoopPump;
};

/** The seven callbacks `registerPluginWindowHost` hands the addon. */
export type PluginWindowHost = {
    readonly create: (request: CreateEditorWindowRequest) => CreateEditorWindowResponse;
    readonly exists: (label: string) => boolean;
    readonly setSize: (request: EditorWindowSizeRequest) => void;
    readonly showAndFocus: (label: string) => void;
    readonly destroy: (label: string) => void;
    readonly hide: (label: string) => void;
    readonly show: (label: string) => void;
};

/**
 * The scale reported when the platform's own answer is unusable.
 *
 * One converts nothing, which is the only answer that cannot make an editor the
 * wrong size on a display nobody could measure.
 */
const UNSCALED = 1;

const usableScaleFactor = (reported: number): number =>
    Number.isFinite(reported) && reported > 0 ? reported : UNSCALED;

const failure = (error: string): CreateEditorWindowResponse => ({
    handle: null,
    parented: false,
    scaleFactor: UNSCALED,
    error,
});

export const createPluginWindowHost = (deps: PluginWindowHostDeps): PluginWindowHost => {
    const editors = new Map<string, EditorWindow>();

    // Keyed off the registry rather than off open/close calls, because the
    // registry is the one place every arrival and departure passes through —
    // including the OS close nobody asked for.
    const trackEditorCount = (): void => {
        if (editors.size === 0) {
            deps.runLoopPump?.stop();
            return;
        }
        deps.runLoopPump?.start();
    };

    const buildWindow = (title: string): { window: EditorWindow; parented: boolean } => {
        const parent = deps.getParentWindow();
        if (parent !== undefined) {
            try {
                return { window: deps.createWindow({ title, parent, alwaysOnTop: false }), parented: true };
            } catch (error) {
                // The platform refused the parent; an unparented editor with
                // the always-on-top fallback is the seam's defined state.
                console.warn(`[shell] platform refused the editor window parent: ${String(error)}`);
            }
        }
        return { window: deps.createWindow({ title, parent: undefined, alwaysOnTop: true }), parented: false };
    };

    const create = (request: CreateEditorWindowRequest): CreateEditorWindowResponse => {
        if (editors.has(request.label)) {
            return failure(`A window labelled ${request.label} already exists`);
        }

        let built: { window: EditorWindow; parented: boolean };
        try {
            built = buildWindow(request.title);
        } catch (error) {
            return failure(String(error));
        }
        const { window, parented } = built;

        // Wired before the window is published, per the seam contract: a
        // window that exists with no close handling is a leak. The reset is
        // idempotent and tolerates a close for a window that was never
        // published.
        window.on('closed', () => {
            if (editors.get(request.label) === window) {
                editors.delete(request.label);
                trackEditorCount();
            }
            deps.notifyClosed(request.instanceId, request.label);
        });
        editors.set(request.label, window);
        trackEditorCount();

        try {
            return {
                handle: window.getNativeWindowHandle(),
                parented,
                scaleFactor: usableScaleFactor(deps.getScaleFactor()),
                error: null,
            };
        } catch (error) {
            editors.delete(request.label);
            trackEditorCount();
            window.destroy();
            return failure(String(error));
        }
    };

    const withEditor = (label: string, operate: (window: EditorWindow) => void): void => {
        const window = editors.get(label);
        if (window !== undefined && !window.isDestroyed()) {
            operate(window);
        }
    };

    return {
        create,
        exists: (label) => editors.has(label),
        setSize: (request) => {
            withEditor(request.label, (window) => {
                window.setContentSize(request.width, request.height);
            });
        },
        showAndFocus: (label) => {
            withEditor(label, (window) => {
                window.show();
                window.focus();
            });
        },
        destroy: (label) => {
            withEditor(label, (window) => {
                window.destroy();
            });
        },
        hide: (label) => {
            withEditor(label, (window) => {
                window.hide();
            });
        },
        show: (label) => {
            withEditor(label, (window) => {
                // Focus-free on purpose: a shown plugin editor must not steal
                // focus, and `show_all_plugin_guis` re-focusing each editor in
                // iteration order would land focus arbitrarily.
                window.showInactive();
            });
        },
    };
};

/** The addon methods this module drives; a stale addon may lack them. */
export type PluginWindowNative = {
    readonly registerPluginWindowHost: (
        createEditorWindow: PluginWindowHost['create'],
        editorWindowExists: PluginWindowHost['exists'],
        setEditorWindowSize: PluginWindowHost['setSize'],
        showAndFocusEditorWindow: PluginWindowHost['showAndFocus'],
        destroyEditorWindow: PluginWindowHost['destroy'],
        hideEditorWindow: PluginWindowHost['hide'],
        showEditorWindow: PluginWindowHost['show']
    ) => void;
    /** Async on the addon side; typed loosely because the router-facing addon type is untyped. */
    readonly notifyPluginWindowClosed: (instanceId: string, label: string) => unknown;
    /** One pass over every open editor's run loop. Returns how many callbacks ran. */
    readonly servicePluginEditorRunLoops: () => number;
};

/**
 * How often the run loop is pumped while an editor is open.
 *
 * A plugin's X11 handlers and timers are dispatched from here, so this is the
 * granularity of its own animation and input handling; a frame at 60 Hz is what
 * the plugin would get from a native host's loop.
 */
const RUN_LOOP_INTERVAL_MS = 16;

/**
 * Whether this platform's hosted formats need the host to drive their run loop.
 *
 * VST3 defines `IRunLoop` for Linux alone; every other platform's plugins are
 * dispatched by the OS toolkit the shell already runs.
 */
const needsEditorRunLoopPump = (): boolean => process.platform === 'linux';

/** An idempotent interval pump: repeated starts keep the one timer. */
export const createIntervalRunLoopPump = (
    service: () => void,
    interval: number = RUN_LOOP_INTERVAL_MS
): EditorRunLoopPump => {
    let timer: ReturnType<typeof setInterval> | undefined;
    return {
        start: () => {
            timer ??= setInterval(service, interval);
        },
        stop: () => {
            if (timer === undefined) {
                return;
            }
            clearInterval(timer);
            timer = undefined;
        },
    };
};

/**
 * Whether a loaded addon carries this seam.
 *
 * A predicate rather than a `Partial<PluginWindowNative>` parameter, and the
 * same shape `native.ts` uses to validate the addon it loaded. The caller
 * passes the live `NativeHost`, whose only declared members are `shutdown` and
 * an index signature of positional `NativeCommand`s — nothing that structurally
 * matches these two typed signatures, so a `Partial` parameter cannot accept it
 * and the assignability error it raises is real rather than pedantic. Narrowing
 * here states what is actually true: the members are checked at runtime,
 * because whether the compiled addon has them is a property of the binary on
 * disk and of nothing the compiler can see.
 */
const hasPluginWindowHost = (native: object): native is PluginWindowNative =>
    typeof Reflect.get(native, 'registerPluginWindowHost') === 'function' &&
    typeof Reflect.get(native, 'notifyPluginWindowClosed') === 'function' &&
    typeof Reflect.get(native, 'servicePluginEditorRunLoops') === 'function';

/**
 * Register the shell's window callbacks with the addon.
 *
 * Survives an addon built before this packet — the rest of the native surface
 * works and plugin editors keep refusing to open, exactly the pre-T-4 state —
 * rather than turning a stale binary into a startup crash.
 */
export const registerPluginWindowHost = (
    native: object,
    deps: Omit<PluginWindowHostDeps, 'notifyClosed' | 'runLoopPump'>
): boolean => {
    if (!hasPluginWindowHost(native)) {
        console.error(
            '[shell] the native addon predates the plugin window host; plugin editors are unavailable until it is rebuilt'
        );
        return false;
    }
    const {
        registerPluginWindowHost: register,
        notifyPluginWindowClosed: notifyClosed,
        servicePluginEditorRunLoops: serviceRunLoops,
    } = native;

    const host = createPluginWindowHost({
        ...deps,
        runLoopPump: needsEditorRunLoopPump()
            ? createIntervalRunLoopPump(() => {
                  serviceRunLoops.call(native);
              })
            : undefined,
        notifyClosed: (instanceId, label) => {
            // Fire and forget: the napi method is async, so this only
            // schedules the reset on the addon's executor.
            void Promise.resolve(notifyClosed.call(native, instanceId, label)).catch((error: unknown) => {
                console.error(`[shell] plugin window close reset failed: ${String(error)}`);
            });
        },
    });
    register.call(
        native,
        host.create,
        host.exists,
        host.setSize,
        host.showAndFocus,
        host.destroy,
        host.hide,
        host.show
    );
    return true;
};
