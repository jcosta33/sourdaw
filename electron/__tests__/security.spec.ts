/**
 * The permission policy is the shell's only allow-list, and every mistake it
 * can make is silent in the product: a wrongly denied permission surfaces as a
 * button that does nothing, or — for the File System Access API — as a save
 * dialog that completes and then throws away what the user asked to write.
 *
 * So the decision is asserted twice: once as the pure verdict, and once through
 * the handlers Electron actually calls, because a verdict function that is
 * correct while the handler forwards none of the request details is a check
 * that passes blind.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ALLOWED_PERMISSIONS,
    applyPermissionPolicy,
    FILE_SYSTEM_PERMISSION,
    type FileSystemAccess,
    isFileSystemAccessAllowed,
    isPermissionAllowed,
    normalizeOrigin,
    type PermissionPolicy,
} from '../security.js';

import type { Session, WebContents } from 'electron';

// `main.ts` imports Electron's whole main-process surface at load time; every
// other module it pulls in resolves the same mocked module. `vi.mock` is
// hoisted above the imports above, so the real `electron` package is never
// reached. `vi.hoisted` is required to hand the factory a place to record
// what it saw, since the factory itself runs before this file's own
// top-level `const`s would otherwise exist.
const { mainWindowConstructorCalls } = vi.hoisted(() => ({
    mainWindowConstructorCalls: [] as Record<string, unknown>[],
}));

vi.mock('electron', () => {
    class MockBrowserWindow {
        static fromWebContents = vi.fn();
        readonly webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn(), getURL: () => '' };
        readonly once = vi.fn();
        readonly on = vi.fn();
        readonly isDestroyed = (): boolean => false;
        readonly loadURL = vi.fn(() => Promise.resolve());
        readonly show = vi.fn();
        readonly hide = vi.fn();
        readonly destroy = vi.fn();
        readonly close = vi.fn();
        constructor(options: Record<string, unknown>) {
            mainWindowConstructorCalls.push(options);
        }
    }
    return {
        app: {
            isPackaged: false,
            getAppPath: () => '/app',
            whenReady: () => Promise.resolve(),
            on: vi.fn(),
            exit: vi.fn(),
            quit: vi.fn(),
        },
        BrowserWindow: MockBrowserWindow,
        BaseWindow: { getFocusedWindow: vi.fn() },
        dialog: { showErrorBox: vi.fn() },
        ipcMain: { handle: vi.fn() },
        Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn(), sendActionToFirstResponder: vi.fn() },
        screen: { on: vi.fn() },
        session: {
            defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
        },
        shell: { openExternal: vi.fn(), openPath: vi.fn() },
        utilityProcess: { fork: vi.fn() },
        protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
        net: { fetch: vi.fn() },
    };
});

// `startNativeSurface` (inside `main.ts`'s `whenReady` callback) resolves
// `resolveNativeAddonPath` for real and hands it to `loadNativeAddon`, which
// otherwise `require`s whatever that path names — a build artifact this unit
// spec must not depend on, and a path an operator's `SOURDAW_NATIVE_ADDON`
// env var could point anywhere. Only the loader is stubbed; every other
// export — the path resolution, the env constants — stays real through
// `importOriginal`, so this spec still exercises the seam main.ts actually
// calls through.
vi.mock('../native.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../native.js')>();
    return {
        ...actual,
        loadNativeAddon: (): never => {
            throw new Error('stubbed: no native addon in this unit spec');
        },
    };
});

const APP_ORIGIN = 'app://sourdaw';
const FOREIGN_ORIGIN = 'https://evil.example';
const policy: PermissionPolicy = { allowedOrigins: [APP_ORIGIN] };

type RequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
type CheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
type RequestPermission = Parameters<RequestHandler>[1];
type CheckPermission = Parameters<CheckHandler>[1];

const requireInstalled = <T>(handler: T | undefined, name: string): T => {
    if (handler === undefined) {
        throw new Error(`${name} was never installed`);
    }
    return handler;
};

/** The renderer's `webContents`; only its URL is ever read, and only as a fallback. */
const webContentsAt = (url: string): WebContents => ({ getURL: () => url }) as unknown as WebContents;

const installHandlers = (): { request: RequestHandler; check: CheckHandler } => {
    let request: RequestHandler | undefined;
    let check: CheckHandler | undefined;
    applyPermissionPolicy(
        {
            setPermissionRequestHandler: (handler) => {
                request = handler ?? undefined;
            },
            setPermissionCheckHandler: (handler) => {
                check = handler ?? undefined;
            },
        },
        policy
    );
    return {
        request: requireInstalled(request, 'permission request handler'),
        check: requireInstalled(check, 'permission check handler'),
    };
};

/** Drive the real request handler the way Electron does, and read its verdict. */
const requestVerdict = (
    permission: RequestPermission,
    requestingUrl: string,
    access: FileSystemAccess = {}
): boolean => {
    const { request } = installHandlers();
    let granted: boolean | undefined;
    request(
        webContentsAt(APP_ORIGIN),
        permission,
        (value) => {
            granted = value;
        },
        { requestingUrl, isMainFrame: true, ...access }
    );
    return requireInstalled(granted, 'permission request callback');
};

const checkVerdict = (
    permission: CheckPermission,
    requestingOrigin: string,
    access: FileSystemAccess = {}
): boolean => {
    const { check } = installHandlers();
    return check(null, permission, requestingOrigin, { isMainFrame: true, ...access });
};

describe('normalizeOrigin', () => {
    it('should reduce an app-scheme URL to scheme and host', () => {
        // `URL.origin` answers "null" for a non-special scheme, which would deny
        // every permission the product asks for.
        expect(normalizeOrigin('app://sourdaw/index.html')).toBe(APP_ORIGIN);
        expect(normalizeOrigin('app://sourdaw/')).toBe(APP_ORIGIN);
    });

    it('should keep a port, so a ported host is a different origin', () => {
        expect(normalizeOrigin('app://sourdaw:1234/index.html')).toBe('app://sourdaw:1234');
    });

    it('should answer undefined for an absent or unparseable URL', () => {
        expect(normalizeOrigin(undefined)).toBeUndefined();
        expect(normalizeOrigin('')).toBeUndefined();
        expect(normalizeOrigin('not a url')).toBeUndefined();
    });
});

describe('isPermissionAllowed', () => {
    it.each([...ALLOWED_PERMISSIONS])('should allow %s on the app origin', (permission) => {
        expect(isPermissionAllowed(policy, permission, `${APP_ORIGIN}/index.html`)).toBe(true);
    });

    it.each([...ALLOWED_PERMISSIONS])('should deny %s off the app origin', (permission) => {
        expect(isPermissionAllowed(policy, permission, `${FOREIGN_ORIGIN}/index.html`)).toBe(false);
    });

    it('should deny a permission that is on no list', () => {
        expect(isPermissionAllowed(policy, 'geolocation', `${APP_ORIGIN}/index.html`)).toBe(false);
        expect(isPermissionAllowed(policy, 'display-capture', `${APP_ORIGIN}/index.html`)).toBe(false);
    });

    it('should deny everything when the requesting URL is missing', () => {
        expect(isPermissionAllowed(policy, 'media', undefined)).toBe(false);
    });

    it('should not allow fileSystem on the permission string alone', () => {
        // The string is not the request: without an access type there is
        // nothing to scope the grant to.
        expect(ALLOWED_PERMISSIONS.has(FILE_SYSTEM_PERMISSION)).toBe(false);
        expect(isPermissionAllowed(policy, FILE_SYSTEM_PERMISSION, `${APP_ORIGIN}/index.html`)).toBe(false);
    });
});

describe('isFileSystemAccessAllowed', () => {
    it('should allow writing a picked file', () => {
        // `showSaveFilePicker()` then `createWritable()`: project download, DAW
        // project export, and the stem export dialog, which has no fallback.
        expect(isFileSystemAccessAllowed({ isDirectory: false, fileAccessType: 'writable' })).toBe(true);
    });

    it('should allow reading a picked file', () => {
        // Chromium pairs a read grant with every picked file handle; refusing
        // it leaves a handle whose write half is allowed and is still unusable.
        expect(isFileSystemAccessAllowed({ isDirectory: false, fileAccessType: 'readable' })).toBe(true);
    });

    it('should allow reading a picked directory', () => {
        // `showDirectoryPicker({ mode: 'read' })` — connecting a sample folder.
        expect(isFileSystemAccessAllowed({ isDirectory: true, fileAccessType: 'readable' })).toBe(true);
    });

    it('should deny writing into a picked directory', () => {
        // Nothing asks for it, and it is the one combination that turns a
        // single picked folder into a writable tree.
        expect(isFileSystemAccessAllowed({ isDirectory: true, fileAccessType: 'writable' })).toBe(false);
    });

    it('should deny an access type it cannot recognise', () => {
        expect(isFileSystemAccessAllowed({ isDirectory: false })).toBe(false);
        expect(isFileSystemAccessAllowed({ isDirectory: true })).toBe(false);
        expect(isFileSystemAccessAllowed({})).toBe(false);
    });
});

describe('applyPermissionPolicy', () => {
    it('should carry the fileSystem details from the request into the verdict', () => {
        // Fails if the handler stops forwarding `details`: without them every
        // fileSystem request looks like the unscoped one, which is denied.
        expect(
            requestVerdict(FILE_SYSTEM_PERMISSION, `${APP_ORIGIN}/index.html`, {
                isDirectory: false,
                fileAccessType: 'writable',
            })
        ).toBe(true);
        expect(
            requestVerdict(FILE_SYSTEM_PERMISSION, `${APP_ORIGIN}/index.html`, {
                isDirectory: true,
                fileAccessType: 'readable',
            })
        ).toBe(true);
    });

    it('should deny a directory write and a foreign origin through the request handler', () => {
        expect(
            requestVerdict(FILE_SYSTEM_PERMISSION, `${APP_ORIGIN}/index.html`, {
                isDirectory: true,
                fileAccessType: 'writable',
            })
        ).toBe(false);
        expect(
            requestVerdict(FILE_SYSTEM_PERMISSION, `${FOREIGN_ORIGIN}/`, {
                isDirectory: false,
                fileAccessType: 'writable',
            })
        ).toBe(false);
    });

    it('should reach the same fileSystem verdict in the check handler as in the request handler', () => {
        // Electron asks the check handler for the status of a grant it already
        // made. A check that disagrees hands out a handle and then refuses it.
        const cases: readonly FileSystemAccess[] = [
            { isDirectory: false, fileAccessType: 'writable' },
            { isDirectory: false, fileAccessType: 'readable' },
            { isDirectory: true, fileAccessType: 'readable' },
            { isDirectory: true, fileAccessType: 'writable' },
            {},
        ];
        for (const access of cases) {
            expect(checkVerdict(FILE_SYSTEM_PERMISSION, `${APP_ORIGIN}/`, access)).toBe(
                requestVerdict(FILE_SYSTEM_PERMISSION, `${APP_ORIGIN}/index.html`, access)
            );
        }
    });

    it('should fall back to the webContents URL when the request carries no URL', () => {
        const { request } = installHandlers();
        let granted: boolean | undefined;
        request(
            webContentsAt(`${APP_ORIGIN}/index.html`),
            'media',
            (value) => {
                granted = value;
            },
            { requestingUrl: '', isMainFrame: true }
        );
        expect(granted).toBe(true);
    });

    it('should keep denying an unlisted permission through the handlers', () => {
        expect(requestVerdict('geolocation', `${APP_ORIGIN}/index.html`)).toBe(false);
        expect(checkVerdict('geolocation', APP_ORIGIN)).toBe(false);
    });
});

describe('main window webPreferences', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('pins sandbox, contextIsolation, nodeIntegration and backgroundThrottling for the real main window', async () => {
        // The stubbed `loadNativeAddon` throws inside `startNativeSurface`'s
        // own try/catch, which reports through `console.error`. Spying on it
        // proves the addon seam was actually reached and stubbed, rather than
        // skipped for an unrelated reason — a spec that never checks this
        // could stay green even if the mock above silently stopped applying.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        // `main.ts` creates its one window inside `app.whenReady().then(...)`,
        // which our mocked `app.whenReady()` resolves immediately; importing
        // it here drives the real `createWindow` and the real `BrowserWindow`
        // constructor call, not a re-implementation of either.
        await import('../main.js');
        await new Promise((resolve) => setImmediate(resolve));

        expect(consoleError).toHaveBeenCalledOnce();
        expect(consoleError.mock.calls[0]?.[0]).toContain('did not load');

        const [options] = mainWindowConstructorCalls;
        const webPreferences = options?.webPreferences as Record<string, unknown> | undefined;

        // Each is load-bearing for a different reason: the first three are
        // Electron's own defaults, and a copied config or a future default
        // change must not quietly hand the renderer Node; the fourth is what
        // keeps the audio graph, the transport clock, the meters and the live
        // automation writer running while the window is hidden or minimised —
        // see `nativeEnginePlayheadFeedState.ts`.
        expect(webPreferences).toMatchObject({
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        });
    });
});
