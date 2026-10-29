import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRuntimeScope } from '../runtimeScope.js';

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
        constructor(_options: Record<string, unknown>) {
            state.windows.push(this);
            state.order.push('window');
        }
    }

    const windows: MockBrowserWindow[] = [];
    const order: string[] = [];
    const addon: { SourdawNative?: unknown } = {};
    const state = {
        addon,
        fork: vi.fn((..._args: unknown[]) => ({ postMessage: vi.fn(), on: vi.fn(), kill: vi.fn() })),
        forkDuringSetup: false,
        lockGranted: true,
        ready: deferred(),
        listeners: new Map<string, EventListener>(),
        windows,
        order,
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
        setPath: (name: string, path: string) => state.order.push(`${name}:${path}`),
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
    utilityProcess: { fork: state.fork },
    // `main.ts` builds the power-save controller (#2165) at import time from
    // this surface; nothing here drives it, but the import needs the three
    // reads `PowerSaveBlockerLike` names.
    powerSaveBlocker: { start: vi.fn(() => 0), stop: vi.fn(), isStarted: vi.fn(() => false) },
}));

vi.mock('../native.js', () => ({
    NATIVE_ADDON_PATH_ENV: 'SOURDAW_NATIVE_ADDON',
    loadNativeAddon: () => {
        state.nativeLoads();
        return state.addon;
    },
    resolveNativeAddonPath: () => '/native-addon.node',
    resolveScanHelperPath: () => '/scan-helper',
}));

// Execute the production fork adapter once and stop before any simulated renderer.
vi.mock('../scan.js', () => ({
    createScanSupervisor: (input: { fork: () => unknown }) => {
        if (state.forkDuringSetup) {
            input.fork();
        }
        throw new Error('scan fork observed; no simulated project window');
    },
}));

const homes: string[] = [];
let stdoutListeners: Array<(error: Error) => void> = [];
let stderrListeners: Array<(error: Error) => void> = [];
const fixture = (): string => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-scope-startup-')));
    homes.push(home);
    const root = join(home, '.sourdaw-native-runtime-scopes-v1', randomUUID());
    mkdirSync(root, { recursive: true });
    return root;
};

beforeEach(() => {
    vi.resetModules();
    state.reset();
    state.fork.mockClear();
    state.forkDuringSetup = false;
    stdoutListeners = process.stdout.listeners('error');
    stderrListeners = process.stderr.listeners('error');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const listener of process.stdout.listeners('error')) {
        if (!stdoutListeners.includes(listener)) {
            process.stdout.removeListener('error', listener);
        }
    }
    for (const listener of process.stderr.listeners('error')) {
        if (!stderrListeners.includes(listener)) {
            process.stderr.removeListener('error', listener);
        }
    }
    for (const home of homes.splice(0)) {
        rmSync(home, { recursive: true, force: true });
    }
});

describe('actual main entry scoped startup', () => {
    it('sets all private Chromium paths before the profile lock and ready callback', async () => {
        const root = fixture();
        vi.stubEnv('SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT', root);
        await import('../main.js');
        expect(state.order).toEqual([
            'register-scheme',
            `userData:${join(root, 'chromium/userData')}`,
            `sessionData:${join(root, 'chromium/sessionData')}`,
            `logs:${join(root, 'logs')}`,
            'request-lock',
        ]);
        expect(state.nativeLoads).not.toHaveBeenCalled();
    });

    it('rejects an empty explicit selection before requesting the profile lock', async () => {
        vi.stubEnv('SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT', '');
        await expect(import('../main.js')).rejects.toThrow('SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT');
        expect(state.requestLock).not.toHaveBeenCalled();
        expect(state.windows).toHaveLength(0);
        expect(state.nativeLoads).not.toHaveBeenCalled();
    });

    it('rejects an old addon before construction and never creates a project window', async () => {
        vi.stubEnv('SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT', fixture());
        const oldConstructor = vi.fn();
        state.addon = { SourdawNative: oldConstructor };
        await import('../main.js');
        state.ready.resolve();
        await vi.waitFor(() => expect(state.exit).toHaveBeenCalledWith(1));
        expect(oldConstructor).not.toHaveBeenCalled();
        expect(state.windows).toHaveLength(0);
    });

    it('passes the frozen canonical selection to the production scan fork adapter', async () => {
        const root = fixture();
        vi.stubEnv('SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT', root);
        const scope = resolveRuntimeScope(process.env);
        if (scope === undefined) {
            throw new Error('scope missing');
        }
        for (const path of Object.values(scope.paths)) {
            mkdirSync(path, { recursive: true });
        }
        class Host {
            static withRuntimeScopeV1 = vi.fn(() => new Host());
            shutdown = vi.fn();
            grantPath = vi.fn();
            beginRendererSession = vi.fn();
            startDictation = vi.fn();
            stopDictation = vi.fn();
            cancelDictation = vi.fn();
            runtimeScopeInfoV1() {
                return { ...scope?.paths, version: 1, exportStateAvailable: true };
            }
        }
        state.addon = { SourdawNative: Host };
        state.forkDuringSetup = true;
        await import('../main.js');
        // A later environment mutation must not redirect the native scan supervisor.
        vi.stubEnv('SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT', '/wrong-later-setting');
        state.ready.resolve();
        await vi.waitFor(() => expect(state.fork).toHaveBeenCalledOnce());
        expect(state.fork.mock.calls[0]?.[2]).toMatchObject({
            env: { SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT: root, SOURDAW_NATIVE_ADDON: '/native-addon.node' },
        });
        expect(Host.withRuntimeScopeV1).toHaveBeenCalledExactlyOnceWith(expect.any(Function), root);
        await vi.waitFor(() => expect(state.exit).toHaveBeenCalledWith(1));
    });
});
