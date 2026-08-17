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
 * this file was written that way and denied two capabilities the product uses,
 * one of them silently. Each entry below names the API that triggers it, which
 * is what makes the entry checkable; the search that produced them was over
 * `navigator.mediaDevices`, `navigator.requestMIDIAccess`, `setSinkId`,
 * `navigator.clipboard`, `navigator.storage` and `navigator.permissions`.
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

export type PermissionPolicy = {
    /** Origins allowed to hold the permissions above — the app, plus the dev server when running unpackaged. */
    readonly allowedOrigins: readonly string[];
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
    requestingUrl: string | undefined
): boolean => {
    if (!ALLOWED_PERMISSIONS.has(permission)) {
        return false;
    }
    const origin = normalizeOrigin(requestingUrl);
    return origin !== undefined && policy.allowedOrigins.some((allowed) => normalizeOrigin(allowed) === origin);
};

export const applyPermissionPolicy = (session: Session, policy: PermissionPolicy): void => {
    session.setPermissionRequestHandler((webContents: WebContents | null, permission, callback, details) => {
        const requestingUrl = details.requestingUrl !== '' ? details.requestingUrl : webContents?.getURL();
        callback(isPermissionAllowed(policy, permission, requestingUrl));
    });

    session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
        isPermissionAllowed(policy, permission, requestingOrigin)
    );
};
