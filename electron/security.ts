/**
 * Session permission policy (REQ-008).
 *
 * Electron's default is to grant every permission a page asks for. That is the
 * wrong default for a DAW shell: the renderer runs third-party model output and
 * user-authored content, and the permissions that matter here — the microphone
 * and the MIDI bus, including SysEx, which can reflash a controller — are
 * exactly the ones an attacker would want. So the handler denies by default.
 *
 * The origin check is the other half. A grant is scoped to the shell's own
 * origin, so a permission prompt raised by anything that is not the app — an
 * embedded frame, a page reached through a navigation bug — is denied even when
 * it asks for a permission the app itself is allowed.
 */
import type { Session, WebContents } from 'electron';

/**
 * The permissions the renderer is allowed to hold, on the app's origin only.
 *
 * Derived by walking the renderer for the Web APIs that raise a Chromium
 * permission, not from a list written ahead of the code — the first version of
 * this file was written that way and denied capabilities the product uses,
 * silently. Each entry below names the API that triggers it, which is what
 * makes the entry checkable.
 *
 * Re-running that derivation means sweeping two namespaces, not one. On
 * `navigator`: `mediaDevices`, `requestMIDIAccess`, `clipboard`, `storage`,
 * `permissions` — plus `setSinkId`, which hangs off `AudioContext`. On `window`
 * itself: `showSaveFilePicker`, `showOpenFilePicker`, `showDirectoryPicker`.
 * The File System Access API is a window-level API that Electron brokers
 * through this same handler, so a sweep restricted to `navigator.*` cannot see
 * it — and did not, which is how `fileSystem` was missed the first time. Any
 * later sweep that reports "nothing new" while looking only at `navigator` has
 * observed nothing.
 *
 * - `media` — `navigator.mediaDevices.getUserMedia`: audio input, recording and
 *   input monitoring.
 * - `midi`, `midiSysex` — `navigator.requestMIDIAccess`. Chromium raises the
 *   SysEx variant for a sysex-enabled request; the shell grants both so that
 *   enabling SysEx in the renderer is not also a shell change.
 * - `speaker-selection` — `AudioContext.setSinkId`, the output-device picker.
 * - `clipboard-sanitized-write` — `navigator.clipboard.writeText`, which the
 *   collaboration invite flow uses. Denying it rejects a promise the call sites
 *   do not await, so a refusal is invisible: the copy button does nothing and
 *   the session cannot be shared.
 * - `persistent-storage` — `navigator.storage.persist()`. A refusal is handled,
 *   but it leaves downloaded models and origin-private project data evictable
 *   under memory pressure, which is a worse guarantee than the browser build's.
 *
 * `fileSystem` is deliberately absent: it is allowed, but not by name alone.
 * See `FILE_SYSTEM_PERMISSION` below.
 *
 * Adding to this list is a security decision: it must name the API that needs
 * it, and that API must exist in the renderer.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
    'media',
    'midi',
    'midiSysex',
    'speaker-selection',
    'clipboard-sanitized-write',
    'persistent-storage',
]);

/**
 * The File System Access API, brokered through this handler since
 * electron#41419 under this permission string.
 *
 * Not a seventh member of the set above, because the string is not the whole
 * request: `details` carries `filePath`, `isDirectory` and `fileAccessType`,
 * and the renderer needs only some of those combinations. Granting the string
 * would hand a user-picked *directory tree* write access to buy a single file
 * write, which is the widest reach anything in this file grants.
 */
export const FILE_SYSTEM_PERMISSION = 'fileSystem';

/** The `fileSystem` fields of an Electron permission request or check. */
export type FileSystemAccess = {
    readonly isDirectory?: boolean;
    readonly fileAccessType?: 'writable' | 'readable';
};

/**
 * The scope of the `fileSystem` grant: files read or written, directories read
 * only — nothing writes into a user-picked directory.
 *
 * Why each half exists, by the call site that needs it:
 *
 * - file + `writable` — `window.showSaveFilePicker()` then
 *   `handle.createWritable()`, in `downloadProjectFile.ts`,
 *   `handleExportDawProject.ts` and `ExportDialog.tsx`. The first two catch a
 *   refusal and fall back to an anchor download, so denial costs the user the
 *   chosen location. The export dialog has no such fallback on the handle
 *   branch: its catch only sets error text, so a denial there discards a
 *   completed offline stem render *after* the user picked a destination — all
 *   of the cost, none of the result.
 * - file + `readable` — the read grant Chromium pairs with every picked file
 *   handle. Electron consults this policy for the *status* of a grant it has
 *   already auto-granted internally (`GetStatus` delegates wholesale once a
 *   permission check handler is installed), so denying the read half of a
 *   handle whose write half is allowed produces a handle no call site can use.
 * - directory + `readable` — `window.showDirectoryPicker({ mode: 'read' })` in
 *   `connectFolder.ts`, and the `{ mode: 'read' }` query/request that
 *   re-establishes a persisted library root on restart. Denied, the sample
 *   library cannot connect a folder at all.
 * - directory + `writable` — denied. Nothing asks for it: the shell's own
 *   writes go to OPFS, which is origin-private and never brokered here.
 *
 * An absent or unrecognised `fileAccessType` is denied. Electron sets it on
 * every `fileSystem` request it raises, so a missing one is a request this
 * policy has not reasoned about, and the safe answer to that is no.
 */
export const isFileSystemAccessAllowed = (access: FileSystemAccess): boolean => {
    if (access.isDirectory === true) {
        return access.fileAccessType === 'readable';
    }
    return access.fileAccessType === 'readable' || access.fileAccessType === 'writable';
};

export type PermissionPolicy = {
    /** Origins allowed to hold the permissions above — the app, plus the dev server when running unpackaged. */
    readonly allowedOrigins: readonly string[];
};

/**
 * Whether the shell will navigate to this URL.
 *
 * Anything off-app is off-app: a link in a chat panel, a redirect from a model
 * provider, a crafted `location =`. Those belong in the user's browser, never
 * in a window that holds the session.
 *
 * A separate function from `isPermissionAllowed` only because the inputs
 * differ; the origin comparison is the same one, deliberately, so a URL that
 * cannot navigate here also cannot hold a permission.
 */
export const isNavigationAllowed = (allowedOrigins: readonly string[], url: string): boolean => {
    const origin = normalizeOrigin(url);
    return origin !== undefined && allowedOrigins.some((allowed) => normalizeOrigin(allowed) === origin);
};

/**
 * The origin check every IPC handler runs before it does anything (REQ-004).
 *
 * The same allow-list navigation uses, lifted here rather than composed at the
 * call site: this one line is the whole sender-origin guard, and a copy of it
 * living in the composition root is a line no spec can reach. The spoofed-frame
 * assertions drive this export, so they observe the guard the shell installs
 * rather than a re-implementation of it.
 *
 * `undefined` is refused. A sender frame that has already gone has no URL, and
 * a request from a frame that no longer exists cannot be shown to be the app —
 * the ordinary case during a renderer crash, and not one to trust.
 *
 * The origins are read through a function because the allow-list depends on the
 * dev server, which is resolved after this guard is handed to the router.
 */
export const trustedFrameGuard =
    (allowedOrigins: () => readonly string[]) =>
    (url: string | undefined): boolean =>
        url !== undefined && isNavigationAllowed(allowedOrigins(), url);

/**
 * What to do with a window-open request.
 *
 * A DAW window is the session. Nothing gets to open a second one, so the action
 * is always `deny`; the only question is whether the target is an ordinary web
 * URL worth handing to the user's browser.
 *
 * The URL comes from the renderer and is not guaranteed to parse. An exception
 * inside Electron's window-open path propagates rather than denying, so an
 * unparseable target is treated as hostile here instead of thrown on.
 */
export type WindowOpenDecision = {
    readonly action: 'deny';
    readonly openExternally: boolean;
    readonly legalDocument?: 'THIRD-PARTY-NOTICES.md';
};

export const decideWindowOpen = (url: string): WindowOpenDecision => {
    try {
        const target = new URL(url);
        if (
            target.protocol === 'app:' &&
            target.host === 'sourdaw' &&
            target.pathname === '/legal/THIRD-PARTY-NOTICES.md' &&
            target.search === '' &&
            target.hash === ''
        ) {
            return { action: 'deny', openExternally: false, legalDocument: 'THIRD-PARTY-NOTICES.md' };
        }
        return { action: 'deny', openExternally: /^https?:$/u.test(target.protocol) };
    } catch {
        return { action: 'deny', openExternally: false };
    }
};

/**
 * Reduce a URL or origin string to `scheme://host`.
 *
 * Not `URL.origin`: Node does not know that Chromium treats `app:` as a
 * standard scheme, so it reports the origin of every `app://sourdaw/...` URL as
 * the string `"null"`. Comparing that against the app origin denied every
 * permission the product asks for — the first boot of the shell logged
 * `[MIDI] Web MIDI failed` because of exactly this. Scheme plus host is well
 * defined for both a full URL and a bare origin, under any scheme.
 */
export const normalizeOrigin = (url: string | undefined): string | undefined => {
    if (url === undefined || url === '') {
        return undefined;
    }
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return undefined;
    }
};

/**
 * The whole decision, in one place, so the request handler and the check
 * handler cannot drift apart: a permission the app can request but not check
 * (or the reverse) is a permission that fails at a random point in a session.
 */
export const isPermissionAllowed = (
    policy: PermissionPolicy,
    permission: string,
    requestingUrl: string | undefined,
    access: FileSystemAccess = {}
): boolean => {
    const origin = normalizeOrigin(requestingUrl);
    const isAppOrigin =
        origin !== undefined && policy.allowedOrigins.some((allowed) => normalizeOrigin(allowed) === origin);
    if (!isAppOrigin) {
        return false;
    }
    if (permission === FILE_SYSTEM_PERMISSION) {
        return isFileSystemAccessAllowed(access);
    }
    return ALLOWED_PERMISSIONS.has(permission);
};

/**
 * The slice of `Session` this policy installs into. Narrower than `Session` so
 * that the wiring can be exercised against the two handlers it actually sets,
 * rather than against a fabricated whole session.
 */
export type PermissionSession = Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>;

export const applyPermissionPolicy = (session: PermissionSession, policy: PermissionPolicy): void => {
    session.setPermissionRequestHandler((webContents: WebContents | null, permission, callback, details) => {
        const requestingUrl = details.requestingUrl !== '' ? details.requestingUrl : webContents?.getURL();
        // `in` rather than a cast: `details` is a union, and only its
        // filesystem member carries these. A request that is not a `fileSystem`
        // request therefore yields an empty access shape, which is denied — the
        // same answer the permission string alone would have given.
        const access: FileSystemAccess = {
            isDirectory: 'isDirectory' in details ? details.isDirectory : undefined,
            fileAccessType: 'fileAccessType' in details ? details.fileAccessType : undefined,
        };
        callback(isPermissionAllowed(policy, permission, requestingUrl, access));
    });

    // The check handler carries the same three fields, and must reach the same
    // verdict: Electron asks it for the *status* of a filesystem grant on every
    // read and write, so a check that disagrees with the request would grant a
    // handle and then refuse to use it.
    session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
        isPermissionAllowed(policy, permission, requestingOrigin, {
            isDirectory: details.isDirectory,
            fileAccessType: details.fileAccessType,
        })
    );
};
