import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Lane-scoped browser verification. Two agent lanes share one machine, so a
 * dev server pinned to one fixed port lets lane A's e2e silently verify lane
 * B's server. The pieces here bind a run to its own checkout: an env-driven
 * port (so each lane claims a distinct one), and a serving-checkout marker
 * asserted before any existing server is reused. Kept free of any dependency
 * beyond node builtins: vite.config.ts, playwright.config.ts, the e2e global
 * setup, and the agent ui-scripts all import it, and the ui-scripts run under
 * Node type stripping without a bundler.
 */

export const SOURDAW_E2E_PORT_ENV = 'SOURDAW_E2E_PORT';

/** Preserves the human default: no env var means today's port. */
export const DEFAULT_E2E_PORT = 5173;

const MIN_E2E_PORT = 1024;
const MAX_E2E_PORT = 65535;

/**
 * Resolve the e2e dev-server port from `SOURDAW_E2E_PORT`. Unset (or empty,
 * as shells leave it after `export VAR=`) keeps the default 5173; any other
 * value must be an integer in 1024–65535 or the run refuses to start rather
 * than bind an unintended port.
 */
export function resolveE2ePort(rawPort: string | undefined): number {
    if (rawPort === undefined || rawPort === '') {
        return DEFAULT_E2E_PORT;
    }
    if (!/^\d+$/.test(rawPort)) {
        throw new Error(
            `${SOURDAW_E2E_PORT_ENV} must be an integer between ${MIN_E2E_PORT} and ${MAX_E2E_PORT}, got "${rawPort}"`
        );
    }
    const port = Number(rawPort);
    if (port < MIN_E2E_PORT || port > MAX_E2E_PORT) {
        throw new Error(
            `${SOURDAW_E2E_PORT_ENV} must be an integer between ${MIN_E2E_PORT} and ${MAX_E2E_PORT}, got "${rawPort}"`
        );
    }
    return port;
}

export function e2eOrigin(port: number): string {
    return `http://localhost:${port}`;
}

/** Response header carrying the serving checkout's absolute vite root. */
export const SOURDAW_E2E_ROOT_HEADER = 'X-Sourdaw-Root';

/**
 * The identity marker exists only when the dev server runs `--mode e2e`. A
 * human's plain `pnpm dev` and the WebGPU admission proof's server
 * deliberately run without that mode, so they carry no marker and reuse of
 * them stays allowed.
 */
export function isSourdawE2eServeMode(mode: string): boolean {
    return mode === 'e2e';
}

export type RootHeaderMiddleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

/**
 * Dev-server middleware stamping the serving checkout's root on every
 * response. Installed before Vite's own middleware so served bodies carry it
 * too; the value is whatever root the server actually resolved at startup,
 * never the asking client's. The root is percent-encoded because Node
 * rejects HTTP header values above latin1 (U+00FF) with ERR_INVALID_CHAR,
 * and a checkout path such as an accented macOS home directory in its
 * default NFD spelling would make every e2e-mode response throw.
 */
export function createSourdawRootHeaderMiddleware(root: string): RootHeaderMiddleware {
    return (_request, response, next) => {
        response.setHeader(SOURDAW_E2E_ROOT_HEADER, encodeURIComponent(root));
        next();
    };
}

/**
 * Inverse of the stamp's percent-encoding. A malformed escape passes through
 * verbatim: the value only feeds the identity comparison and its mismatch
 * message, so an unparseable marker must surface there, not crash the probe.
 */
function decodeSourdawRoot(stamped: string): string {
    try {
        return decodeURIComponent(stamped);
    } catch {
        return stamped;
    }
}

/** Read the serving checkout's marker, or null when the server carries none. */
export async function readServingCheckoutRoot(origin: string): Promise<string | null> {
    const response = await fetch(origin);
    const stamped = response.headers.get(SOURDAW_E2E_ROOT_HEADER);
    await response.body?.cancel();
    return stamped === null ? null : decodeSourdawRoot(stamped);
}

export async function originAnswers(origin: string): Promise<boolean> {
    try {
        await fetch(origin);
        return true;
    } catch {
        return false;
    }
}

/**
 * Compare roots the way two spellings of one directory stay equal: a worktree
 * path can be reached through symlinked directories, and Vite reports its
 * cwd-lexical root while the importing module may hold the realpath. A false
 * mismatch here would abort every run, so both sides go through realpath
 * before comparison. The reported mismatch message keeps the raw strings.
 */
function comparableRoot(root: string): string {
    try {
        return realpathSync(root);
    } catch {
        return resolve(root);
    }
}

/**
 * Assert that the server at `origin` belongs to `expectedRoot` before this
 * run reuses it. A marker naming a different checkout aborts with both roots
 * and the origin, naming the port. A missing marker passes: only e2e-mode
 * servers carry one (see isSourdawE2eServeMode).
 */
export async function assertServingCheckoutIdentity(origin: string, expectedRoot: string): Promise<void> {
    let servingRoot: string | null;
    try {
        servingRoot = await readServingCheckoutRoot(origin);
    } catch (error) {
        throw new Error(`Cannot verify the serving checkout: no server answered at ${origin}.`, { cause: error });
    }
    if (servingRoot === null) {
        return;
    }
    if (comparableRoot(servingRoot) === comparableRoot(expectedRoot)) {
        return;
    }
    throw new Error(
        `Refusing to reuse a dev server from another checkout: ${origin} serves ${servingRoot}, but this browser verification runs from ${expectedRoot}. ` +
            `Stop that server or set ${SOURDAW_E2E_PORT_ENV} to a lane-unique port.`
    );
}
