/**
 * Session permission policy (REQ-008).
 *
 * Electron's default is to grant every permission a page asks for. That is the
 * wrong default for a DAW shell: the renderer runs third-party model output and
 * user-authored content, and the permissions that matter here — the microphone
 * and the MIDI bus, including SysEx, which can reflash a controller — are
 * exactly the ones an attacker would want. So the handler denies by default and
 * names the four capabilities the product actually uses.
 *
 * The origin check is the other half. A grant is scoped to the shell's own
 * origin, so a permission prompt raised by anything that is not the app — an
 * embedded frame, a page reached through a navigation bug — is denied even when
 * it asks for a permission the app itself is allowed.
 */
import type { Session, WebContents } from 'electron';

/**
 * `media` covers microphone and camera capture (audio input, recording).
 * `midi` and `midiSysex` cover controller I/O. `speaker-selection` covers the
 * output-device picker. Nothing else in the product asks for a permission.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'midi', 'midiSysex', 'speaker-selection']);

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
