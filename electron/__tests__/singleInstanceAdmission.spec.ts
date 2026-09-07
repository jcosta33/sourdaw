import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MockBrowserWindow, state } = vi.hoisted(() => {
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
        static fromWebContents = vi.fn();
        readonly webContents = {
            getURL: () => 'app://sourdaw/',
            on: vi.fn(),
            send: vi.fn(),
            setWindowOpenHandler: vi.fn(),
        };
        readonly once = vi.fn();
        readonly on = vi.fn();
        readonly loadURL = vi.fn(() => Promise.resolve());
        readonly show = vi.fn();
        readonly hide = vi.fn();
        readonly close = vi.fn();
        readonly destroy = vi.fn(() => {
            this.destroyed = true;
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
    }

    const state = {
        lockGranted: true,
        ready: deferred(),
        listeners: new Map<string, (...args: never[]) => void>(),
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
        on: (event: string, listener: (...args: never[]) => void) => {
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
    await Promise.resolve();
    await Promise.resolve();
};

const emitSecondInstance = (): void => {
    const listener = state.listeners.get('second-instance');
    if (listener === undefined) {
        throw new Error('main entry did not register second-instance');
    }
    listener();
};

describe('Electron single-instance admission', () => {
    beforeEach(() => {
        vi.resetModules();
        state.reset();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
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

    it('admits the primary before startup and routes later activation through the existing single-window lifecycle', async () => {
        await import('../main.js');

        expect(state.order).toEqual(['register-scheme', 'request-lock']);
        expect(state.whenReady).toHaveBeenCalledOnce();

        emitSecondInstance();
        expect(state.windows).toHaveLength(0);

        state.ready.resolve();
        await flushStartup();
        expect(state.windows).toHaveLength(1);
        expect(state.nativeLoads).toHaveBeenCalledOnce();

        const primaryWindow = state.windows[0];
        if (primaryWindow === undefined) {
            throw new Error('ready startup did not create the primary window');
        }
        primaryWindow.minimized = true;
        emitSecondInstance();

        expect(primaryWindow.restore).toHaveBeenCalledOnce();
        expect(primaryWindow.show).toHaveBeenCalledOnce();
        expect(primaryWindow.focus).toHaveBeenCalledOnce();
        expect(state.windows).toHaveLength(1);

        primaryWindow.destroyed = true;
        emitSecondInstance();

        expect(state.windows).toHaveLength(2);
    });
});
