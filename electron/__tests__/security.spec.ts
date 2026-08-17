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
import { describe, expect, it } from 'vitest';

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
