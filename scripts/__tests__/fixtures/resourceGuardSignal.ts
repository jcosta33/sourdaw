import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { main, runGuardedCommand } from '../../resourceGuard.ts';
import { createGuardStorage, type StorageProcessIdentity } from '../../resourceGuardStorage.ts';

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let captureSignalTimer = false;
let capturedTimers = 0;
let fallback: (() => void) | undefined;
let fallbackHandle: NodeJS.Timeout | undefined;
let fallbackAdmitted = false;
let ownedChild: StorageProcessIdentity | undefined;
let tempDirectory: string | undefined;
let storageReleaseEntered = false;
let guardedSigtermHandler: ReturnType<typeof process.listeners>[number] | undefined;
let holdAbort = process.env.SOURDAW_SIGNAL_HOLD_ABORT === '1';
let holdIdentity = process.env.SOURDAW_SIGNAL_HOLD_IDENTITY === '1';
let releaseStorage: (() => void) | undefined;
const storageAdmission = new Promise<void>((resolve) => {
    releaseStorage = resolve;
});

function report(event: string, details: Record<string, unknown> = {}): void {
    process.send?.({ event, ...details });
}

function publishIdentity(): void {
    if (ownedChild !== undefined && !holdIdentity) {
        report('owned-child', { ...ownedChild, tempDirectory });
    }
}

function admitFallback(): void {
    if (fallbackAdmitted) {
        return;
    }
    fallbackAdmitted = true;
    originalClearTimeout(fallbackHandle);
    fallback?.();
}

function abort(): void {
    if (holdAbort) {
        report('abort-held', {
            childKnown: ownedChild !== undefined,
            tempExists: tempDirectory !== undefined && existsSync(tempDirectory),
        });
        return;
    }
    releaseStorage?.();
    if (!storageReleaseEntered && ownedChild !== undefined) {
        if (capturedTimers === 0) {
            process.emit('SIGTERM');
        }
        admitFallback();
    }
}

function suppressRepeatedSignal(): void {
    report('repeated-signal-suppressed');
}

function captureFirstSignal(): void {
    captureSignalTimer = true;
    queueMicrotask(() => {
        captureSignalTimer = false;
        if (capturedTimers !== 1) {
            throw new Error(`expected exactly one signal fallback timer, observed ${capturedTimers}`);
        }
        report('fallback-scheduled', { capturedTimers });
    });
}

// stop('signal') schedules its fallback synchronously in the first signal turn.
// Keep its real timer handle and cancellation, but require explicit fallback admission.
const controlledSetTimeout = (...parameters: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
    const [callback, delay, ...args] = parameters;
    if (!captureSignalTimer) {
        return originalSetTimeout(callback, delay, ...args);
    }
    if (delay !== 5_000 || capturedTimers !== 0) {
        throw new Error(`ambiguous timer in signal turn: delay=${delay}, prior=${capturedTimers}`);
    }
    capturedTimers += 1;
    fallback = () => {
        report('fallback-invoked');
        callback(...args);
    };
    fallbackHandle = originalSetTimeout(() => {
        report('fallback-due');
        if (fallbackAdmitted) {
            fallback?.();
        }
    }, delay);
    return fallbackHandle;
};
globalThis.setTimeout = Object.assign(controlledSetTimeout, originalSetTimeout);

globalThis.clearTimeout = (handle) => {
    if (handle === fallbackHandle) {
        report('fallback-cleared');
        fallback = undefined;
    }
    originalClearTimeout(handle);
};

process.prependOnceListener('SIGTERM', captureFirstSignal);
process.on('message', (message: string) => {
    if (message === 'suppress-repeat') {
        if (
            capturedTimers !== 1 ||
            fallback === undefined ||
            fallbackAdmitted ||
            guardedSigtermHandler === undefined ||
            !process.listeners('SIGTERM').includes(guardedSigtermHandler)
        ) {
            throw new Error('repeated-signal suppression requires the captured fallback and identified guard handler');
        }
        process.removeListener('SIGTERM', guardedSigtermHandler);
        process.on('SIGTERM', suppressRepeatedSignal);
        report('repeat-suppression-installed');
    } else if (message === 'abort') {
        abort();
    } else if (message === 'admit-abort') {
        holdAbort = false;
        abort();
    } else if (message === 'publish-identity') {
        holdIdentity = false;
        publishIdentity();
    } else if (message === 'admit-fallback') {
        admitFallback();
    } else if (message === 'release-storage') {
        releaseStorage?.();
    } else if (message === 'inspect') {
        report('inspection', { fallbackAdmitted });
    }
});

const fixtureSigtermHandlers = new Set(process.listeners('SIGTERM'));

try {
    process.exitCode = await main(process.argv.slice(2), {
        runCommand: (input) =>
            runGuardedCommand({
                ...input,
                availableMemoryBytes: 128 * 1024 ** 3,
                storageRoot: join(process.cwd(), 'storage'),
                storageFactory: (options) => {
                    const storage = createGuardStorage(options);
                    tempDirectory = storage.tempDirectory;
                    return {
                        ...storage,
                        recordProcesses: (child, tracked) => {
                            storage.recordProcesses(child, tracked);
                            if (child !== undefined) {
                                const addedHandlers = process
                                    .listeners('SIGTERM')
                                    .filter((handler) => !fixtureSigtermHandlers.has(handler));
                                if (addedHandlers.length !== 1 || addedHandlers[0]?.name !== 'onSigterm') {
                                    throw new Error(
                                        'expected exactly the guard SIGTERM handler after child identity publication'
                                    );
                                }
                                guardedSigtermHandler = addedHandlers[0];
                                ownedChild = child;
                                publishIdentity();
                            }
                        },
                        release: async (treeStopped) => {
                            storageReleaseEntered = true;
                            report('storage-release-entered', {
                                ...ownedChild,
                                treeStopped,
                                tempExists: existsSync(storage.tempDirectory),
                                fallbackAdmitted,
                            });
                            await storageAdmission;
                            const removed = await storage.release(treeStopped);
                            report('storage-released', { removed, treeStopped, ...ownedChild });
                            return removed;
                        },
                    };
                },
            }),
    });
} finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    process.removeListener('SIGTERM', captureFirstSignal);
    process.removeListener('SIGTERM', suppressRepeatedSignal);
    process.disconnect?.();
}
