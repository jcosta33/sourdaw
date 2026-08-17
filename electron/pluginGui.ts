/**
 * Native plugin editor windows for the Electron shell (packet T-4).
 *
 * The addon owns every decision about a plugin editor — whether it may open,
 * the CLAP lifecycle, the bookkeeping, the close/hide/show semantics. This
 * module only knows how to make a bare native window on this platform, exactly
 * as `src-tauri/src/windows.rs` does for the Tauri shell: it is the JS half of
 * the `PluginWindowHost` seam, registered as threadsafe-function callbacks at
 * startup.
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

export type PluginWindowHostDeps = {
    readonly createWindow: (options: EditorWindowOptions) => EditorWindow;
    /** The live DAW window, re-read per create because it is replaced on a renderer crash. */
    readonly getParentWindow: () => BaseWindow | undefined;
    /** Reports an OS-level close to the addon. Must only schedule, never block. */
    readonly notifyClosed: (instanceId: string, label: string) => void;
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

const failure = (error: string): CreateEditorWindowResponse => ({ handle: null, parented: false, error });

export const createPluginWindowHost = (deps: PluginWindowHostDeps): PluginWindowHost => {
    const editors = new Map<string, EditorWindow>();

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
            }
            deps.notifyClosed(request.instanceId, request.label);
        });
        editors.set(request.label, window);

        try {
            return { handle: window.getNativeWindowHandle(), parented, error: null };
        } catch (error) {
            editors.delete(request.label);
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
                // Focus-free by seam parity: Tauri's `show_window` does not
                // steal focus, and `show_all_plugin_guis` re-focusing each
                // editor in iteration order would land focus arbitrarily.
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
};

/**
 * Register the shell's window callbacks with the addon.
 *
 * Survives an addon built before this packet — the rest of the native surface
 * works and plugin editors keep refusing to open, exactly the pre-T-4 state —
 * rather than turning a stale binary into a startup crash.
 */
export const registerPluginWindowHost = (
    native: Partial<PluginWindowNative>,
    deps: Omit<PluginWindowHostDeps, 'notifyClosed'>
): boolean => {
    const { registerPluginWindowHost: register, notifyPluginWindowClosed: notifyClosed } = native;
    if (typeof register !== 'function' || typeof notifyClosed !== 'function') {
        console.error(
            '[shell] the native addon predates the plugin window host; plugin editors are unavailable until it is rebuilt'
        );
        return false;
    }

    const host = createPluginWindowHost({
        ...deps,
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
