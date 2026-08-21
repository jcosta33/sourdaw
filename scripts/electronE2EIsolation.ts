import { type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ElectronUserDataScope = {
    directory: string;
    argument: string;
};

type IsolatedElectronRun<Resource, Result> = {
    launch: (scope: ElectronUserDataScope) => Promise<Resource>;
    run: (resource: Resource) => Promise<Result>;
    shutdown: (resource: Resource) => Promise<void>;
};

/**
 * Own one fresh Chromium profile for exactly one Electron launch.
 *
 * Shutdown completes before the profile is removed. The absolute directory is
 * created here and never inferred from process state, so cleanup cannot reach
 * Electron's default profile or another concurrent proof's profile.
 */
export async function withIsolatedElectronUserData<Resource, Result>(
    operation: IsolatedElectronRun<Resource, Result>
): Promise<Result> {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-e2e-'));
    const scope: ElectronUserDataScope = {
        directory,
        argument: `--user-data-dir=${directory}`,
    };
    let resource: Resource | undefined;

    try {
        resource = await operation.launch(scope);
        return await operation.run(resource);
    } finally {
        try {
            if (resource !== undefined) {
                await operation.shutdown(resource);
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }
}

export function waitForChildProcessExit(process: ChildProcess, timeoutMs: number): Promise<void> {
    if (process.exitCode !== null || process.signalCode !== null) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const finish = (error?: Error): void => {
            clearTimeout(timeout);
            process.off('exit', onExit);
            process.off('error', onError);
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        };
        const onExit = (): void => finish();
        const onError = (error: Error): void => finish(error);
        const timeout = setTimeout(
            () => finish(new Error(`Electron process did not exit within ${String(timeoutMs)}ms`)),
            timeoutMs
        );
        process.once('exit', onExit);
        process.once('error', onError);
    });
}

/** Request a normal exit, then force and confirm termination if it stalls. */
export async function terminateChildProcess(process: ChildProcess, timeoutMs = 5_000): Promise<void> {
    if (process.exitCode !== null || process.signalCode !== null) {
        return;
    }
    process.kill('SIGTERM');
    try {
        await waitForChildProcessExit(process, timeoutMs);
    } catch {
        process.kill('SIGKILL');
        await waitForChildProcessExit(process, timeoutMs);
    }
}
