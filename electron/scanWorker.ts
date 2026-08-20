/**
 * The plugin-scan `utilityProcess` entry point (REQ-007).
 *
 * This file runs in two roles, and which one it is in is decided by the process
 * arguments the addon reads:
 *
 * 1. **Leaf worker.** Started by the Rust scan policy, once per plugin, with
 *    `--sourdaw-plugin-scan-worker <format> <plugin> <response>`.
 *    `runPluginScanWorker` extracts the descriptor and returns the exit code
 *    this process must end with. This is the only place a CLAP entry point is
 *    ever loaded.
 * 2. **Supervisor.** Forked by the main process. It runs the scan and answers
 *    with the result.
 *
 * The leaf check is first, before anything else is set up, because in that role
 * the process exists only to load one hostile library and die.
 *
 * ## Why the spawn command has to be declared
 *
 * The Rust policy launches a leaf by re-executing `current_exe()` with the
 * worker arguments. Under Tauri that was the app binary, which scanned its own
 * argv on startup. Under Electron `current_exe()` is the Electron binary, and
 * handing it a bare `--sourdaw-plugin-scan-worker` argument starts neither a
 * worker nor a usable process. So this file publishes the command that *does*
 * re-enter it — Electron in its Node role, running this script — and the policy
 * uses it. The bounded child process, its timeout, its process-group kill and
 * the path authorization are all unchanged.
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
 * The command that re-enters this script as a leaf worker.
 *
 * `ELECTRON_RUN_AS_NODE` is what makes the Electron binary behave as plain
 * Node: without it the child would try to start as an Electron application,
 * with a browser process and a window, for every plugin on the machine.
 */
export const scanWorkerCommand = (execPath: string, scriptPath: string): ScanWorkerCommand => ({
    program: execPath,
    args: [scriptPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
});

export type ScanWorkerRequest = { readonly paths: readonly string[] };

/** Parse a supervisor request. An unrecognised message is answered, never obeyed. */
export const asScanWorkerRequest = (message: unknown): ScanWorkerRequest | undefined => {
    if (
        typeof message === 'object' &&
        message !== null &&
        'paths' in message &&
        Array.isArray(message.paths) &&
        message.paths.every((entry) => typeof entry === 'string')
    ) {
        return { paths: message.paths };
    }
    return undefined;
};

/** Read one addon method, failing by name rather than as `undefined is not a function`. */
export const nativeCommand = (host: NativeHost, method: string): NativeCommand => {
    const implementation = host[method];
    if (typeof implementation !== 'function') {
        throw new TypeError(`The native addon does not implement ${method}`);
    }
    return implementation;
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

    const workerExitCode = addon.runPluginScanWorker();
    if (workerExitCode !== null) {
        process.exit(workerExitCode);
    }

    process.env[SCAN_WORKER_COMMAND_ENV] = JSON.stringify(scanWorkerCommand(process.execPath, import.meta.filename));

    const host = new addon.SourdawNative(() => {
        // The scan path pushes no events, and this process has no renderer to
        // push them to. A sink that does nothing is deliberate: the addon
        // requires one, and forwarding from here would invent a second event
        // path that nothing listens on.
    });
    const scanPlugins = nativeCommand(host, 'scanPlugins');

    process.parentPort.on('message', (event) => {
        const request = asScanWorkerRequest(event.data);
        if (request === undefined) {
            process.parentPort.postMessage({ ok: false, error: 'The plugin scan request was malformed' });
            return;
        }
        void (async () => {
            try {
                process.parentPort.postMessage({ ok: true, result: await scanPlugins(request.paths) });
            } catch (error) {
                process.parentPort.postMessage({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();
    });
};

// Only when this file is the process entry. A spec importing it for the pure
// helpers above must not load a native addon or claim `parentPort`.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
    main();
}
