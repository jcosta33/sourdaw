import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MockBrowserWindow, state } = vi.hoisted(() => {
    type EventListener = (...args: unknown[]) => void;
    type Deferred = {
        readonly promise: Promise<void>;
        readonly resolve: () => void;
    };

    const deferred = (): Deferred => {
        let resolveReady = (): void => undefined;
        const promise = new Promise<void>((resolve) => {
            resolveReady = resolve;
        });
        return { promise, resolve: resolveReady };
    };

    class MockBrowserWindow {
        static fromWebContents = vi.fn(() => state.windows.at(-1) ?? null);
        private readonly eventListeners = new Map<string, EventListener[]>();
        private readonly onceListeners = new Map<string, Array<() => void>>();
        readonly webContents = {
            getURL: () => 'app://sourdaw/',
            on: vi.fn(),
            send: vi.fn(),
            setWindowOpenHandler: vi.fn(),
        };
        readonly once = vi.fn((event: string, listener: () => void) => {
            const listeners = this.onceListeners.get(event) ?? [];
            listeners.push(listener);
            this.onceListeners.set(event, listeners);
        });
        readonly on = vi.fn((event: string, listener: EventListener) => {
            const listeners = this.eventListeners.get(event) ?? [];
            listeners.push(listener);
            this.eventListeners.set(event, listeners);
        });
        readonly loadURL = vi.fn(() => Promise.resolve());
        readonly show = vi.fn();
        readonly hide = vi.fn();
        readonly close = vi.fn();
        readonly destroy = vi.fn(() => {
            this.destroyed = true;
            this.emitClosed();
        });
        readonly restore = vi.fn();
        readonly focus = vi.fn();
        destroyed = false;
        minimized = false;

        constructor(_options: Record<string, unknown>) {
            state.windows.push(this);
            state.order.push('window');
        }

        isDestroyed = (): boolean => this.destroyed;
        isMinimized = (): boolean => this.minimized;

        emitClosed(): void {
            const listeners = this.onceListeners.get('closed') ?? [];
            this.onceListeners.delete('closed');
            for (const listener of listeners) {
                listener();
            }
        }
    }

    const state = {
        lockGranted: true,
        ready: deferred(),
        listeners: new Map<string, EventListener>(),
        windows: [] as MockBrowserWindow[],
        order: [] as string[],
        exit: vi.fn(),
        requestLock: vi.fn(() => state.lockGranted),
        nativeLoads: vi.fn(),
        whenReady: vi.fn(() => state.ready.promise),
        reset: (): void => {
            state.lockGranted = true;
            state.ready = deferred();
            state.listeners.clear();
            state.windows.length = 0;
            state.order.length = 0;
            state.exit.mockClear();
            state.requestLock.mockClear();
            state.nativeLoads.mockClear();
            state.whenReady.mockClear();
            MockBrowserWindow.fromWebContents.mockClear();
        },
    };

    return { MockBrowserWindow, state };
});

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/app',
        requestSingleInstanceLock: () => {
            state.order.push('request-lock');
            return state.requestLock();
        },
        whenReady: () => state.whenReady(),
        on: (event: string, listener: (...args: unknown[]) => void) => {
            state.listeners.set(event, listener);
        },
        exit: state.exit,
        quit: vi.fn(),
    },
    BaseWindow: { getFocusedWindow: vi.fn() },
    BrowserWindow: MockBrowserWindow,
    dialog: { showErrorBox: vi.fn() },
    ipcMain: { handle: vi.fn() },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn(), sendActionToFirstResponder: vi.fn() },
    net: { fetch: vi.fn() },
    protocol: {
        handle: vi.fn(),
        registerSchemesAsPrivileged: () => {
            state.order.push('register-scheme');
        },
    },
    screen: { on: vi.fn(), getPrimaryDisplay: vi.fn(), getDisplayMatching: vi.fn() },
    session: { defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } },
    shell: { openExternal: vi.fn(), openPath: vi.fn() },
    utilityProcess: { fork: vi.fn() },
}));

vi.mock('../native.js', () => ({
    NATIVE_ADDON_PATH_ENV: 'SOURDAW_NATIVE_ADDON',
    loadNativeAddon: (): never => {
        state.nativeLoads();
        throw new Error('native addon intentionally absent in single-instance wiring test');
    },
    resolveNativeAddonPath: () => '/native-addon.node',
    resolveScanHelperPath: () => '/scan-helper',
}));

const flushStartup = async (): Promise<void> => {
    await vi.waitFor(() => expect(state.windows).toHaveLength(1));
};

const emitSecondInstance = (): void => {
    const listener = state.listeners.get('second-instance');
    if (listener === undefined) {
        throw new Error('main entry did not register second-instance');
    }
    listener();
};

const emitRendererCrash = (window: InstanceType<typeof MockBrowserWindow>): void => {
    MockBrowserWindow.fromWebContents.mockReturnValueOnce(window);
    const listener = state.listeners.get('render-process-gone');
    if (listener === undefined) {
        throw new Error('main entry did not register render-process-gone');
    }
    listener(undefined, {}, { reason: 'crashed', exitCode: 1 });
};

type ProcessErrorListener = (error: Error) => void;

let stdoutErrorListeners: ProcessErrorListener[] = [];
let stderrErrorListeners: ProcessErrorListener[] = [];

describe('Electron single-instance admission', () => {
    beforeEach(() => {
        vi.resetModules();
        state.reset();
        stdoutErrorListeners = process.stdout.listeners('error');
        stderrErrorListeners = process.stderr.listeners('error');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const listener of process.stdout.listeners('error')) {
            if (!stdoutErrorListeners.includes(listener)) {
                process.stdout.removeListener('error', listener);
            }
        }
        for (const listener of process.stderr.listeners('error')) {
            if (!stderrErrorListeners.includes(listener)) {
                process.stderr.removeListener('error', listener);
            }
        }
        vi.restoreAllMocks();
    });

    it('exits a refused secondary before ready startup can create a renderer or native session', async () => {
        state.lockGranted = false;

        await import('../main.js');

        expect(state.order).toEqual(['register-scheme', 'request-lock']);
        expect(state.exit).toHaveBeenCalledExactlyOnceWith(0);
        expect(state.whenReady).not.toHaveBeenCalled();
        expect(state.windows).toHaveLength(0);
        expect(state.nativeLoads).not.toHaveBeenCalled();
    });

    it('admits the primary before startup without exiting and lets normal ready startup own a pre-ready launch', async () => {
        await import('../main.js');

        expect(state.order).toEqual(['register-scheme', 'request-lock']);
        expect(state.whenReady).toHaveBeenCalledOnce();
        expect(state.exit).not.toHaveBeenCalled();

        emitSecondInstance();
        expect(state.windows).toHaveLength(0);

        state.ready.resolve();
        await flushStartup();
        expect(state.windows).toHaveLength(1);
        expect(state.nativeLoads).toHaveBeenCalledOnce();
        expect(state.exit).not.toHaveBeenCalled();
    });

    it('shows and focuses a live primary whether or not it is minimized without allocating or restarting native startup', async () => {
        await import('../main.js');
        state.ready.resolve();
        await flushStartup();

        const primaryWindow = state.windows[0];
        if (primaryWindow === undefined) {
            throw new Error('ready startup did not create the primary window');
        }

        emitSecondInstance();

        expect(primaryWindow.restore).not.toHaveBeenCalled();
        expect(primaryWindow.show).toHaveBeenCalledOnce();
        expect(primaryWindow.focus).toHaveBeenCalledOnce();
        expect(state.windows).toHaveLength(1);
        expect(state.nativeLoads).toHaveBeenCalledOnce();
        expect(state.exit).not.toHaveBeenCalled();

        primaryWindow.minimized = true;
        emitSecondInstance();

        expect(primaryWindow.restore).toHaveBeenCalledOnce();
        expect(primaryWindow.show).toHaveBeenCalledTimes(2);
        expect(primaryWindow.focus).toHaveBeenCalledTimes(2);
        expect(state.windows).toHaveLength(1);
        expect(state.nativeLoads).toHaveBeenCalledOnce();
        expect(state.exit).not.toHaveBeenCalled();
    });

    it('adopts a replacement for a destroyed owner and does not allocate again when that replacement is activated', async () => {
        await import('../main.js');
        state.ready.resolve();
        await flushStartup();

        const primaryWindow = state.windows[0];
        if (primaryWindow === undefined) {
            throw new Error('ready startup did not create the primary window');
        }
        primaryWindow.destroy();

        emitSecondInstance();
        expect(state.windows).toHaveLength(2);
        expect(state.nativeLoads).toHaveBeenCalledOnce();

        const replacementWindow = state.windows[1];
        if (replacementWindow === undefined) {
            throw new Error('second-instance did not create a replacement');
        }
        emitSecondInstance();

        expect(state.windows).toHaveLength(2);
        expect(replacementWindow.show).toHaveBeenCalledOnce();
        expect(replacementWindow.focus).toHaveBeenCalledOnce();
        expect(state.nativeLoads).toHaveBeenCalledOnce();
        expect(state.exit).not.toHaveBeenCalled();
    });

    it('reopens one adopted window after the real crash teardown leaves no main-window owner', async () => {
        await import('../main.js');
        state.ready.resolve();
        await flushStartup();

        for (let crash = 0; crash < 4; crash += 1) {
            const currentWindow = state.windows.at(-1);
            if (currentWindow === undefined) {
                throw new Error('renderer crash did not have an owned window');
            }
            emitRendererCrash(currentWindow);
        }

        expect(state.windows).toHaveLength(4);
        expect(state.nativeLoads).toHaveBeenCalledOnce();

        emitSecondInstance();
        expect(state.windows).toHaveLength(5);

        const replacementWindow = state.windows[4];
        if (replacementWindow === undefined) {
            throw new Error('windowless primary did not reopen');
        }
        emitSecondInstance();

        expect(state.windows).toHaveLength(5);
        expect(replacementWindow.show).toHaveBeenCalledOnce();
        expect(replacementWindow.focus).toHaveBeenCalledOnce();
        expect(state.nativeLoads).toHaveBeenCalledOnce();
        expect(state.exit).not.toHaveBeenCalled();
    });
});
