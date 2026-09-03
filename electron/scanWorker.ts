/**
 * The plugin-scan `utilityProcess` entry point (REQ-007).
 *
 * This process is the scan supervisor, and only the supervisor: forked once
 * by the main process, it runs the scan through the native addon's
 * `scanPlugins` command and answers with the result. It never becomes a leaf
 * worker itself, and no CLAP or VST3 entry point is ever loaded here.
 *
 * ## Why the leaf never re-enters this process
 *
 * The Rust scan policy (`crates/sourdaw-native/src/host/plugin_scan_worker.rs`)
 * launches one bounded child process per candidate plugin and needs a program
 * to launch it as. That leaf used to be this same script, re-entered by
 * re-executing the Electron binary in its Node role
 * (`ELECTRON_RUN_AS_NODE=1 <electron> scanWorker.js`) — but a packaged build
 * fuses `RunAsNode` off (`scripts/flipElectronFuses.ts`), so that child
 * silently started the full Electron application instead of this script: it
 * never wrote its response, every candidate burned its leaf bound, and the
 * scan budget expired before a musician's plugin was ever reached.
 *
 * The leaf now runs in `sourdaw-plugin-scan-helper`
 * (`crates/sourdaw-native/src/bin/sourdaw-plugin-scan-helper.rs`), a native
 * executable the application ships and builds with no napi or Electron
 * surface at all. `scanWorkerLaunchEnvironment` names it to the Rust policy
 * through `SCAN_WORKER_COMMAND_ENV`, and the policy launches it directly — no
 * runtime, Electron or otherwise, is ever re-entered to inspect a plugin. The
 * bounded child process, its timeout, its process-group kill and the path
 * authorization are all unchanged.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { loadNativeAddon, resolveNativeAddonPath, type NativeCommand, type NativeHost } from './native.js';

/**
 * The env var carrying the leaf spawn command to the Rust policy.
 *
 * Mirrors `SCAN_WORKER_COMMAND_ENV` in
 * `crates/sourdaw-native/src/host/plugin_scan_worker.rs`; the two names are one
 * contract, and `scanWorker.spec.ts` pins them against each other so a rename
 * on one side cannot land alone.
 */
export const SCAN_WORKER_COMMAND_ENV = 'SOURDAW_PLUGIN_SCAN_WORKER_COMMAND';

export type ScanWorkerCommand = {
    readonly program: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
};

/**
 * The command that launches the native scan helper as a leaf worker.
 *
 * No arguments and no environment beyond what the Rust policy itself appends:
 * `sourdaw-plugin-scan-helper` is a plain executable, not a runtime that needs
 * telling how to behave. There is deliberately no `ELECTRON_RUN_AS_NODE` or
 * any other Electron-shaped entry here — the whole point of a dedicated
 * helper is that no runtime re-entry, fused on or off, is ever in the launch
 * path again.
 */
export const scanWorkerCommand = (helperPath: string): ScanWorkerCommand => ({
    program: helperPath,
    args: [],
    env: {},
});

/**
 * The environment variable assignment that hands the leaf launch command to
 * the Rust scan policy.
 *
 * A plain object rather than a side effect on `process.env`: the caller —
 * `main.ts`, building the utility process's fork environment — decides where
 * this lands, and a function that mutated the ambient environment instead
 * would race whichever other setup runs before the fork.
 */
export const scanWorkerLaunchEnvironment = (helperPath: string): Record<string, string> => ({
    [SCAN_WORKER_COMMAND_ENV]: JSON.stringify(scanWorkerCommand(helperPath)),
});

export type ScanWorkerRequest = {
    readonly paths: readonly string[];
    readonly retryQuarantined?: boolean;
};

/** Parse a supervisor request. An unrecognised message is answered, never obeyed. */
export const asScanWorkerRequest = (message: unknown): ScanWorkerRequest | undefined => {
    if (
        typeof message !== 'object' ||
        message === null ||
        !('paths' in message) ||
        !Array.isArray(message.paths) ||
        !message.paths.every((entry) => typeof entry === 'string')
    ) {
        return undefined;
    }
    if ('retryQuarantined' in message) {
        // A present-but-wrong-typed field is refused along with the rest of
        // the message rather than silently dropped: a caller whose flag never
        // arrives would have every quarantined binary scanned again with no
        // sign that the retry request itself was lost.
        if (typeof message.retryQuarantined !== 'boolean') {
            return undefined;
        }
        return { paths: message.paths, retryQuarantined: message.retryQuarantined };
    }
    return { paths: message.paths };
};

/**
 * Read one addon method, failing by name rather than as `undefined is not a
 * function`.
 *
 * The returned function is bound to `host`: `implementation` is a napi class
 * method, and napi throws `Illegal invocation` when it is called with any
 * receiver other than the instance it was read off. A bare `host[method]`
 * reference loses that receiver the moment it is called on its own, so the
 * call goes through `Reflect.apply` with `host` fixed as `this` — the same
 * binding `router.ts` uses for the same class of addon call.
 */
export const nativeCommand = (host: NativeHost, method: string): NativeCommand => {
    const implementation = host[method];
    if (typeof implementation !== 'function') {
        throw new TypeError(`The native addon does not implement ${method}`);
    }
    return (...args) => Reflect.apply(implementation, host, args);
};

export type ScanWorkerResponse =
    { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: string };

/**
 * Handle one supervisor request end to end: parse it, run the scan through
 * `scanPlugins`, and shape the response `scan.ts`'s `asWorkerMessage` expects.
 *
 * Exported and pure of `parentPort` so a test can drive it directly with a
 * fake `scanPlugins` and assert exactly what it was called with — in
 * particular, that a parsed `retryQuarantined` actually reaches the native
 * call rather than being silently dropped between parsing and dispatch.
 */
export const handleScanRequest = async (message: unknown, scanPlugins: NativeCommand): Promise<ScanWorkerResponse> => {
    const request = asScanWorkerRequest(message);
    if (request === undefined) {
        return { ok: false, error: 'The plugin scan request was malformed' };
    }
    try {
        return { ok: true, result: await scanPlugins(request.paths, request.retryQuarantined ?? false) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};

const main = (): void => {
    const addon = loadNativeAddon({
        path: resolveNativeAddonPath({
            env: process.env,
            // The utility process has no `app`, so it cannot ask whether the
            // build is packaged. It does not need to: main resolves the path
            // and passes it in the environment, and this fallback only covers a
            // developer running the script by hand.
            isPackaged: false,
            resourcesPath: process.resourcesPath,
            repoRoot: resolve(dirname(import.meta.dirname), '..'),
        }),
        load: createRequire(import.meta.url),
    });

    const host = new addon.SourdawNative(() => {
        // The scan path pushes no events, and this process has no renderer to
        // push them to. A sink that does nothing is deliberate: the addon
        // requires one, and forwarding from here would invent a second event
        // path that nothing listens on.
    });
    const scanPlugins = nativeCommand(host, 'scanPlugins');

    process.parentPort.on('message', (event) => {
        void handleScanRequest(event.data, scanPlugins).then((response) => {
            process.parentPort.postMessage(response);
        });
    });
};

// Only when this file is the process entry. A spec importing it for the pure
// helpers above must not load a native addon or claim `parentPort`.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
    main();
}
