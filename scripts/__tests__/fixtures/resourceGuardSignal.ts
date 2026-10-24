import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { main, runGuardedCommand } from '../../resourceGuard.ts';
import { createGuardStorage } from '../../resourceGuardStorage.ts';

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let captureSignalTimer = false;
let capturedTimers = 0;
let fallback: (() => void) | undefined;
let fallbackHandle: NodeJS.Timeout | undefined;
let fallbackAdmitted = false;
let releaseStorage: (() => void) | undefined;
const storageAdmission = new Promise<void>((resolve) => {
    releaseStorage = resolve;
});

function report(event: string, details: Record<string, unknown> = {}): void {
    process.send?.({ event, ...details });
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
    if (message === 'admit-fallback') {
        fallbackAdmitted = true;
        originalClearTimeout(fallbackHandle);
        fallback?.();
    } else if (message === 'release-storage') {
        releaseStorage?.();
    } else if (message === 'inspect') {
        report('inspection', { fallbackAdmitted });
    }
});

try {
    process.exitCode = await main(process.argv.slice(2), {
        runCommand: (input) =>
            runGuardedCommand({
                ...input,
                availableMemoryBytes: 128 * 1024 ** 3,
                storageRoot: join(process.cwd(), 'storage'),
                storageFactory: (options) => {
                    const storage = createGuardStorage(options);
                    return {
                        ...storage,
                        release: async (treeStopped) => {
                            report('storage-release-entered', {
                                treeStopped,
                                tempExists: existsSync(storage.tempDirectory),
                                fallbackAdmitted,
                            });
                            await storageAdmission;
                            const removed = await storage.release(treeStopped);
                            report('storage-released', { removed });
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
    process.disconnect?.();
}
