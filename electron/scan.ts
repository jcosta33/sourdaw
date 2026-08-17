/**
 * Plugin scanning, in its own process (REQ-007).
 *
 * A CLAP entry point is third-party native code that the host has to execute in
 * order to learn anything about it, and some of it aborts, hangs or corrupts
 * the process that loaded it. The Rust scan policy already answers that with a
 * bounded child process per plugin, and none of that changes here.
 *
 * What changes is where the *supervisor* runs. Under Tauri it was the
 * application process; under Electron it is a `utilityProcess`, so a scan that
 * takes the supervisor down with it takes down a process the app can rebuild
 * rather than the one holding the session. The addon is loaded there and
 * nowhere else on the scan path, which is what keeps a plugin's code out of the
 * process that owns the audio device.
 *
 * The supervisor below owns three properties, and all three are testable
 * against a fake process because every seam is injected:
 *
 * - **One scan at a time.** A second request while one is running is refused
 *   rather than racing it: two concurrent scans would multiply the plugin
 *   processes and fight over the same policy roots.
 * - **A crash is a failed scan, not a broken app.** A killed or exiting worker
 *   resolves the request as a failure.
 * - **The next scan works.** The worker reference is dropped on every ending,
 *   so the following request forks a fresh one. A supervisor that cached a dead
 *   handle would report the first crash correctly and then never scan again,
 *   which is the failure this is actually guarding.
 */
import type { Timers } from './timers.js';

/**
 * The scan process, as the supervisor drives it.
 *
 * Two named subscriptions rather than one `on(event, …)`: the supervisor needs
 * exactly these two signals, and naming them means the adapter in `main.ts` is
 * the only place that has to know what Electron calls them.
 */
export type ScanProcess = {
    readonly postMessage: (message: unknown) => void;
    readonly onMessage: (listener: (message: unknown) => void) => void;
    readonly onExit: (listener: () => void) => void;
    readonly kill: () => void;
};

export type ScanRequest = {
    readonly paths: readonly string[];
};

export type ForkScanProcess = () => ScanProcess;

export type CreateScanSupervisorInput = {
    readonly fork: ForkScanProcess;
    readonly timeoutMs?: number;
    readonly timers: Timers;
};

/**
 * How long the whole scan gets.
 *
 * Generous next to the per-plugin bound in `plugin_scan_worker.rs`, and
 * deliberately so: this one exists to catch a supervisor that stopped
 * answering, not to time individual plugins. The inner bound is the one that
 * decides how long a single hostile plugin may stall discovery.
 */
export const SCAN_TIMEOUT_MS = 120_000;

export type ScanSupervisor = {
    readonly scan: (request: ScanRequest) => Promise<unknown>;
    /** Whether a worker is currently alive. */
    readonly isRunning: () => boolean;
    /**
     * End any live worker.
     *
     * Called first on the quit path, before the native cascade. A scan is the
     * one part of the shell a hostile plugin can already have wedged, and its
     * worker holds a tree of per-plugin child processes; killing it costs
     * nothing and stops the shutdown deadline being spent on it.
     */
    readonly dispose: () => void;
};

type WorkerMessage = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: string };

const asWorkerMessage = (message: unknown): WorkerMessage => {
    if (typeof message === 'object' && message !== null && 'ok' in message) {
        if (message.ok === true && 'result' in message) {
            return { ok: true, result: message.result };
        }
        if (message.ok === false && 'error' in message && typeof message.error === 'string') {
            return { ok: false, error: message.error };
        }
    }
    return { ok: false, error: 'The plugin scan worker sent an unrecognised message' };
};

export const createScanSupervisor = ({
    fork,
    timeoutMs = SCAN_TIMEOUT_MS,
    timers,
}: CreateScanSupervisorInput): ScanSupervisor => {
    let worker: ScanProcess | undefined;

    const scan = async ({ paths }: ScanRequest): Promise<unknown> => {
        if (worker !== undefined) {
            throw new Error('A plugin scan is already running');
        }

        const current = fork();
        worker = current;

        return new Promise<unknown>((resolve, reject) => {
            let settled = false;
            const finish = (settle: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                deadline.cancel();
                // Dropped before settling, so a caller that starts the next
                // scan from its own `.then` finds the slot free.
                if (worker === current) {
                    worker = undefined;
                }
                settle();
            };

            const deadline = timers.setTimer(() => {
                current.kill();
                finish(() => reject(new Error('The plugin scan worker timed out')));
            }, timeoutMs);

            current.onMessage((message) => {
                const parsed = asWorkerMessage(message);
                finish(() => {
                    if (parsed.ok) {
                        resolve(parsed.result);
                        return;
                    }
                    reject(new Error(parsed.error));
                });
                current.kill();
            });

            // Reached by a clean exit, by a crash, and by an external `kill -9`
            // alike. Electron gives no way to tell them apart here, and the
            // answer is the same for all three: this scan failed and the next
            // one starts a new process.
            current.onExit(() => {
                finish(() => reject(new Error('The plugin scan worker exited before it answered')));
            });

            current.postMessage({ paths });
        });
    };

    return {
        scan,
        isRunning: () => worker !== undefined,
        dispose: () => {
            worker?.kill();
            worker = undefined;
        },
    };
};
