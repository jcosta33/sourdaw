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
 * - When the OS asks to end an editor window, the plugin is still parented into
 *   it, and both formats un-parent against a live parent: VST3 specifies
 *   `IPlugView::removed` against the window the view was attached to, and CLAP's
 *   `gui.destroy` releases the same parenting. So the close is stopped, the
 *   addon's teardown is awaited, and only then is the window destroyed for real.
 *   `destroy` raises no second close, so the shell's own close path — which
 *   already detached before it reached the window host — passes straight
 *   through, and so does the exit cascade.
 * - That teardown must run *off* this event path. The notify call is an async
 *   napi method, so it only schedules work on the addon's executor; running it
 *   inline on the main thread is the documented deadlock with GUI-affine
 *   plugins. It is also why waiting for it means returning from the event
 *   first — which is exactly what stopping the close buys.
 * - A plugin editor's own event loop, where the format has one the host drives,
 *   belongs to the thread that owns the window. That is this thread, so the
 *   pump runs here, and only while an editor is open.
 * - A size is the plugin's to grant, never the shell's to impose. A window the
 *   user drags asks the plugin what it will run at and ends up at that answer;
 *   a window on a display of a different density tells the editor its new scale
 *   and takes the size that produced.
 * - That question is asked once per gesture, when the gesture ends. Answering it
 *   costs the audio host's control claim, held across a hop to this thread, and
 *   every audio block that lands inside a claim is bypassed — so a question per
 *   `resize` event would mute the instrument for the length of a drag. It is
 *   also asked at the only moment the answer cannot fight the user: correcting
 *   the size while the pointer is still down moves the window out from under
 *   the edge being dragged.
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

export type EditorWindowResizableRequest = {
    readonly label: string;
    readonly resizable: boolean;
};

/** One editor's size in the logical units both sides of the seam speak. */
export type EditorSize = {
    readonly width: number;
    readonly height: number;
};

/** The rectangle Electron reports a window's frame and content at. */
export type EditorWindowBounds = {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
};

/**
 * The part of a stoppable Electron window event this module uses.
 *
 * `will-resize` and `close` are both stoppable, and stopping them is the whole
 * of what this module does with either.
 */
export type PreventableEditorEvent = {
    readonly preventDefault: () => void;
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
    readonly getContentSize: () => number[];
    readonly getBounds: () => EditorWindowBounds;
    readonly getContentBounds: () => EditorWindowBounds;
    /**
     * Whether the user may drag this window's edges. Set after the editor is
     * open, because only the plugin knows whether its editor accepts a size the
     * host chose.
     */
    readonly setResizable: (resizable: boolean) => void;
    readonly show: () => void;
    readonly showInactive: () => void;
    readonly focus: () => void;
    readonly hide: () => void;
    readonly destroy: () => void;
    readonly isDestroyed: () => boolean;
    /**
     * One call signature per event, never a union of event names: `BaseWindow`
     * declares one overload per event, so a union parameter matches none of
     * them and the real window stops satisfying this slice.
     */
    readonly on: {
        (event: 'close', listener: (event: PreventableEditorEvent) => void): unknown;
        (event: 'closed', listener: () => void): unknown;
        (event: 'resize', listener: () => void): unknown;
        (event: 'resized', listener: () => void): unknown;
        (event: 'moved', listener: () => void): unknown;
        (
            event: 'will-resize',
            listener: (event: PreventableEditorEvent, newBounds: EditorWindowBounds) => void
        ): unknown;
    };
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
    /**
     * The scale of the display an editor window is on. Answers for the DAW
     * window when given none, which is where an editor is about to open.
     */
    readonly getScaleFactor: (window?: EditorWindow) => number;
    /**
     * Subscribe to the displays changing under the open editors — a monitor
     * added, removed, or rescaled. A window dragged between displays reports
     * itself and does not come through here.
     */
    readonly watchDisplayChanges: (onChanged: () => void) => void;
    /**
     * Ask the plugin to take a size the host chose, and answer with what it
     * granted. Both formats let a plugin quantise or refuse a host-chosen size,
     * so the answer is what the window must end up at.
     */
    readonly requestEditorSize: (instanceId: string, width: number, height: number) => Promise<EditorSize>;
    /**
     * Tell an open editor the display scale it is now running at, and answer
     * with the size it takes at that scale.
     */
    readonly applyEditorScale: (instanceId: string, scaleFactor: number) => Promise<EditorSize>;
    /**
     * Reports an OS-level close to the addon, and resolves once the plugin has
     * left the window. Must only schedule on this thread, never block it: the
     * teardown it runs needs this thread free to carry the editor calls.
     */
    readonly notifyClosed: (instanceId: string, label: string) => Promise<void>;
    /** Absent where no hosted format needs a host-driven run loop. */
    readonly runLoopPump?: EditorRunLoopPump;
};

/** The callbacks `registerPluginWindowHost` hands the addon. */
export type PluginWindowHost = {
    readonly create: (request: CreateEditorWindowRequest) => CreateEditorWindowResponse;
    readonly exists: (label: string) => boolean;
    readonly setSize: (request: EditorWindowSizeRequest) => void;
    readonly setResizable: (request: EditorWindowResizableRequest) => void;
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

const sameSize = (one: EditorSize, other: EditorSize): boolean =>
    one.width === other.width && one.height === other.height;

const contentSizeOf = (window: EditorWindow): EditorSize => {
    const [width, height] = window.getContentSize();
    return { width: width ?? 0, height: height ?? 0 };
};

/**
 * The content size a window would hold at these outer bounds.
 *
 * A drag reports the frame, and the plugin speaks in content units. The chrome
 * between them is whatever the window reports right now, because a resize does
 * not change a window's title bar or borders.
 */
const contentSizeForBounds = (window: EditorWindow, bounds: EditorWindowBounds): EditorSize => {
    const frame = window.getBounds();
    const content = window.getContentBounds();
    return {
        width: Math.max(1, bounds.width - (frame.width - content.width)),
        height: Math.max(1, bounds.height - (frame.height - content.height)),
    };
};

/** One open editor window and what the host knows about the plugin behind it. */
type EditorRecord = {
    readonly window: EditorWindow;
    readonly instanceId: string;
    /**
     * The last size the plugin granted, which is every size this host applied.
     * A resize that matches it is this host's own `setContentSize` echoing back
     * as an event, and asking the plugin about it again never terminates.
     */
    granted: EditorSize | undefined;
    /**
     * The last size the plugin would not take, and what it took instead. Kept
     * so the next drag through that same shape lands on the plugin's answer
     * directly rather than bouncing off it.
     */
    refusal: { readonly requested: EditorSize; readonly granted: EditorSize } | undefined;
    /** The display scale the plugin has taken. */
    scale: number;
    negotiating: boolean;
    scaling: boolean;
    /** The size the window reached while the plugin was answering the last one. */
    queued: EditorSize | undefined;
    /**
     * Whether the user is holding an edge of this window right now.
     *
     * `will-resize` is the only event that means a frame drag, and it fires
     * only on the platforms that also report the drag's commit — so the flag is
     * set exactly where waiting for that commit is safe.
     */
    inGesture: boolean;
    /** The pending settle for a size change no commit is coming for. */
    settle: ReturnType<typeof setTimeout> | undefined;
};

/**
 * How long a window must hold still before its size counts as settled.
 *
 * A heuristic, and the only one available for a size change the platform sends
 * no commit for: a maximise, a keyboard snap, or — where there is no
 * `will-resize` to recognise a drag by — a drag whose pointer pauses this long,
 * which is negotiated mid-gesture. Long enough to sit out an ordinary drag,
 * short enough that the editor follows the window while the user is watching.
 */
const RESIZE_SETTLE_MS = 200;

/**
 * How long a window the OS asked to close is held open for the plugin in it.
 *
 * The teardown crosses to the addon's executor, claims the runtime owner's
 * control gate and hops back to this thread; those two waits are each bounded
 * at two seconds, so a report still outstanding past this is one no plugin is
 * going to answer. Past it the window is destroyed regardless — an editor the
 * user asked to close and cannot is a worse failure than a teardown that missed
 * its parent, which is where every OS close stood before this.
 */
const DETACH_DEADLINE_MS = 5_000;

export const createPluginWindowHost = (deps: PluginWindowHostDeps): PluginWindowHost => {
    const editors = new Map<string, EditorRecord>();

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

    const liveEditor = (label: string): EditorRecord | undefined => {
        const record = editors.get(label);
        return record !== undefined && !record.window.isDestroyed() ? record : undefined;
    };

    /**
     * Put the size the plugin granted on the window, unless it is already there.
     *
     * Usually it is: the backend resizes the host window itself, mid-handshake,
     * through the same seam a plugin-initiated resize uses. This closes the case
     * where it did not — a plugin that granted a size without moving its own
     * window, and the drag the user is still holding.
     */
    const applyGranted = (record: EditorRecord, requested: EditorSize, granted: EditorSize): void => {
        record.granted = granted;
        record.refusal = sameSize(requested, granted) ? undefined : { requested, granted };
        if (record.window.isDestroyed() || sameSize(contentSizeOf(record.window), granted)) {
            return;
        }
        record.window.setContentSize(granted.width, granted.height);
    };

    /**
     * Ask the plugin to take the size the window now has.
     *
     * Coalesced rather than queued: the answer costs a hop to the audio host's
     * worker and back, and a second gesture can commit inside that. Only the
     * newest size is worth asking about, because it is the one the window is at.
     *
     * The size already granted is discarded after the in-flight check, not
     * before it: a size arriving mid-answer has to reach `queued` either way,
     * or the answer's own follow-up negotiates a size the window has left.
     */
    const negotiateSize = async (label: string, requested: EditorSize): Promise<void> => {
        const record = liveEditor(label);
        if (record === undefined) {
            return;
        }
        if (record.negotiating) {
            record.queued = requested;
            return;
        }
        if (record.granted !== undefined && sameSize(record.granted, requested)) {
            return;
        }

        record.negotiating = true;
        try {
            const granted = await deps.requestEditorSize(record.instanceId, requested.width, requested.height);
            applyGranted(record, requested, granted);
        } catch (error) {
            // A plugin that refuses a host resize is not a shell failure: the
            // window keeps the size the user dragged it to, and the editor keeps
            // the size it had.
            console.warn(`[shell] plugin editor refused the resize: ${String(error)}`);
        } finally {
            record.negotiating = false;
            const queued = record.queued;
            record.queued = undefined;
            if (queued !== undefined) {
                void negotiateSize(label, queued);
            }
        }
    };

    /**
     * Tell an editor the scale of the display its window is on now.
     *
     * A no-op when it has not changed, which is what makes this safe to run on
     * every window move and on every display event. `record.scale` is the scale
     * the plugin has *taken*, written only once it answers: recording a scale
     * the editor refused would make that same guard swallow every later attempt
     * and leave the editor at the old density for the rest of its life.
     */
    const followDisplayScale = async (label: string): Promise<void> => {
        const record = liveEditor(label);
        if (record === undefined || record.scaling) {
            return;
        }
        const scale = usableScaleFactor(deps.getScaleFactor(record.window));
        if (scale === record.scale) {
            return;
        }

        record.scaling = true;
        try {
            const granted = await deps.applyEditorScale(record.instanceId, scale);
            record.scale = scale;
            applyGranted(record, granted, granted);
        } catch (error) {
            console.warn(`[shell] plugin editor refused the display scale: ${String(error)}`);
            return;
        } finally {
            record.scaling = false;
        }

        // The window may have reached another display while the plugin was
        // answering. Only after a scale it took: retrying a refusal here would
        // spin, and the next display event retries it anyway.
        if (usableScaleFactor(deps.getScaleFactor(record.window)) !== record.scale) {
            void followDisplayScale(label);
        }
    };

    /** Take the size the window has settled at to the plugin, now. */
    const settleSize = (label: string): void => {
        const record = liveEditor(label);
        if (record === undefined) {
            return;
        }
        clearTimeout(record.settle);
        record.settle = undefined;
        record.inGesture = false;
        void negotiateSize(label, contentSizeOf(record.window));
    };

    /**
     * Restart the pause that stands in for a commit that is not coming.
     *
     * Restarting is the whole point: a size change arriving before the pause
     * elapses replaces the pending one, so the plugin is asked about where the
     * window stopped rather than about somewhere it passed through.
     */
    const scheduleSettle = (label: string): void => {
        const record = liveEditor(label);
        if (record === undefined) {
            return;
        }
        clearTimeout(record.settle);
        record.settle = setTimeout(() => {
            settleSize(label);
        }, RESIZE_SETTLE_MS);
    };

    /** Nothing further is asked of a plugin whose window is going away. */
    const stopPendingResize = (record: EditorRecord | undefined): void => {
        if (record === undefined) {
            return;
        }
        clearTimeout(record.settle);
        record.settle = undefined;
        record.inGesture = false;
    };

    /**
     * Tell the addon a window is ending, and log rather than throw when that
     * fails: neither close path can act on the failure, and both go on to end
     * the window anyway.
     */
    const reportClosedWindow = async (instanceId: string, label: string): Promise<void> => {
        try {
            await deps.notifyClosed(instanceId, label);
        } catch (error) {
            console.error(`[shell] plugin window close reset failed: ${String(error)}`);
        }
    };

    /**
     * End a window the OS asked to close, once the plugin has left it.
     *
     * That order is the whole point of stopping the close, and it is the only
     * one either format is specified against: a view un-parents from a live
     * window or from nothing at all. `destroy` raises no second `close`, so the
     * window ends here and the `closed` bookkeeping still runs exactly once.
     */
    const detachThenDestroy = async (window: EditorWindow, instanceId: string, label: string): Promise<void> => {
        let expiry: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<void>((resolve) => {
            expiry = setTimeout(resolve, DETACH_DEADLINE_MS);
        });
        try {
            await Promise.race([reportClosedWindow(instanceId, label), deadline]);
        } finally {
            clearTimeout(expiry);
        }
        if (!window.isDestroyed()) {
            window.destroy();
        }
    };

    deps.watchDisplayChanges(() => {
        for (const label of editors.keys()) {
            void followDisplayScale(label);
        }
    });

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

        // Whether this window's teardown is already running. A user who clicks
        // the title bar again while the plugin is still leaving must not start a
        // second teardown, and must not get the window destroyed under the first.
        let detaching = false;
        window.on('close', (event: PreventableEditorEvent) => {
            // Stopped before anything else: the plugin is parented into this
            // window, and letting the platform destroy it here is the un-parent
            // against a dead window that both formats forbid.
            event.preventDefault();
            if (detaching) {
                return;
            }
            detaching = true;
            stopPendingResize(editors.get(request.label));
            void detachThenDestroy(window, request.instanceId, request.label);
        });

        window.on('closed', () => {
            const record = editors.get(request.label);
            if (record?.window === window) {
                stopPendingResize(record);
                editors.delete(request.label);
                trackEditorCount();
            }
            // Idempotent on the addon side, which is what makes it safe after a
            // stopped close already reported this window: the second report
            // finds no record and changes nothing.
            void reportClosedWindow(request.instanceId, request.label);
        });

        // A size the plugin already refused is refused again: the drag is
        // stopped where it stands and the window put at the plugin's answer,
        // instead of taking a shape the editor will not draw at and then
        // bouncing off it. Only a repeat can be caught here — the plugin's own
        // answer is asynchronous, and this event is not.
        window.on('will-resize', (event: PreventableEditorEvent, newBounds: EditorWindowBounds) => {
            const record = editors.get(request.label);
            if (record === undefined) {
                return;
            }
            // The one event that means the user is holding an edge, and it
            // arrives only on the platforms that also report the release. Every
            // other way a window changes size — maximise, zoom, a keyboard
            // snap, this host's own correction — reaches `resize` without it.
            record.inGesture = true;

            const refusal = record.refusal;
            if (refusal === undefined || !sameSize(refusal.requested, contentSizeForBounds(window, newBounds))) {
                return;
            }
            event.preventDefault();
            window.setContentSize(refusal.granted.width, refusal.granted.height);
        });

        // Nothing is asked of the plugin while the pointer is down: that drag
        // ends in a commit, and the commit is the trigger. A size change with
        // no drag behind it gets no commit — a maximise and a keyboard snap
        // report nothing but this — so the window holding still stands in for
        // one, and the same fallback is what a platform with no `will-resize`
        // at all runs on.
        window.on('resize', () => {
            if (editors.get(request.label)?.inGesture === true) {
                return;
            }
            scheduleSettle(request.label);
        });

        window.on('resized', () => {
            settleSize(request.label);
        });

        // A window dragged onto another monitor changes density without any
        // display changing, and the editor inside it has to be told.
        window.on('moved', () => {
            void followDisplayScale(request.label);
        });

        const scaleFactor = usableScaleFactor(deps.getScaleFactor());
        editors.set(request.label, {
            window,
            instanceId: request.instanceId,
            granted: undefined,
            refusal: undefined,
            scale: scaleFactor,
            negotiating: false,
            scaling: false,
            queued: undefined,
            inGesture: false,
            settle: undefined,
        });
        trackEditorCount();

        try {
            return {
                handle: window.getNativeWindowHandle(),
                parented,
                scaleFactor,
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
        const record = liveEditor(label);
        if (record !== undefined) {
            operate(record.window);
        }
    };

    return {
        create,
        exists: (label) => editors.has(label),
        setSize: (request) => {
            const record = liveEditor(request.label);
            if (record === undefined) {
                return;
            }
            // Recorded before it is applied: every size that arrives here came
            // from the plugin, and the `resize` event it raises must not be put
            // back to the plugin as a host-driven one.
            record.granted = { width: request.width, height: request.height };
            // The plugin moving itself settles any argument about a size it
            // once refused. Keeping that refusal would veto the user dragging
            // to a size the plugin has since chosen for itself.
            record.refusal = undefined;
            record.window.setContentSize(request.width, request.height);
        },
        setResizable: (request) => {
            withEditor(request.label, (window) => {
                window.setResizable(request.resizable);
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
        setEditorWindowResizable: PluginWindowHost['setResizable'],
        showAndFocusEditorWindow: PluginWindowHost['showAndFocus'],
        destroyEditorWindow: PluginWindowHost['destroy'],
        hideEditorWindow: PluginWindowHost['hide'],
        showEditorWindow: PluginWindowHost['show']
    ) => void;
    /** Async on the addon side; typed loosely because the router-facing addon type is untyped. */
    readonly notifyPluginWindowClosed: (instanceId: string, label: string) => unknown;
    /** Both async on the addon side, and both answer the size the plugin granted. */
    readonly resizePluginGui: (instanceId: string, width: number, height: number) => unknown;
    readonly applyPluginGuiScale: (instanceId: string, scaleFactor: number) => unknown;
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
    typeof Reflect.get(native, 'servicePluginEditorRunLoops') === 'function' &&
    typeof Reflect.get(native, 'resizePluginGui') === 'function' &&
    typeof Reflect.get(native, 'applyPluginGuiScale') === 'function';

/**
 * The size in the addon's answer, checked rather than trusted: it crosses a
 * JSON boundary, and a window sized from a malformed one is a window the user
 * cannot use.
 */
const editorSizeFrom = async (answer: unknown): Promise<EditorSize> => {
    const resolved: unknown = await Promise.resolve(answer);
    if (typeof resolved !== 'object' || resolved === null) {
        throw new Error(`the plugin answered with no editor size: ${String(resolved)}`);
    }
    const width = Number(Reflect.get(resolved, 'width'));
    const height = Number(Reflect.get(resolved, 'height'));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error(`the plugin answered with no usable editor size: ${JSON.stringify(resolved)}`);
    }
    return { width, height };
};

/**
 * Register the shell's window callbacks with the addon.
 *
 * Survives an addon built before this packet — the rest of the native surface
 * works and plugin editors keep refusing to open, exactly the pre-T-4 state —
 * rather than turning a stale binary into a startup crash.
 */
export const registerPluginWindowHost = (
    native: object,
    deps: Omit<PluginWindowHostDeps, 'notifyClosed' | 'runLoopPump' | 'requestEditorSize' | 'applyEditorScale'>
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
        resizePluginGui: resizeGui,
        applyPluginGuiScale: applyScale,
    } = native;

    const host = createPluginWindowHost({
        ...deps,
        runLoopPump: needsEditorRunLoopPump()
            ? createIntervalRunLoopPump(() => {
                  serviceRunLoops.call(native);
              })
            : undefined,
        requestEditorSize: (instanceId, width, height) =>
            editorSizeFrom(resizeGui.call(native, instanceId, width, height)),
        applyEditorScale: (instanceId, scaleFactor) => editorSizeFrom(applyScale.call(native, instanceId, scaleFactor)),
        notifyClosed: async (instanceId, label) => {
            // The napi method is async, so the call itself only schedules the
            // reset on the addon's executor; awaiting it is how the caller knows
            // the plugin is out of the window.
            await Promise.resolve(notifyClosed.call(native, instanceId, label));
        },
    });
    register.call(
        native,
        host.create,
        host.exists,
        host.setSize,
        host.setResizable,
        host.showAndFocus,
        host.destroy,
        host.hide,
        host.show
    );
    return true;
};
