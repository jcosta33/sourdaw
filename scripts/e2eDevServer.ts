import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveE2ePort } from './e2eServerIdentity.ts';

const shutdownTimeoutMs = 3_000;
type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export function runE2eDevServer(root: string, port: number, command: string, args: string[]): void {
    const runId = randomUUID();
    const record = (event: string, details: Record<string, unknown>, done?: () => void): void => {
        process.stderr.write(
            `${JSON.stringify({ source: 'e2e-dev-server', event, runId, time: new Date().toISOString(), ...details })}\n`,
            done
        );
    };
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    let timer: NodeJS.Timeout | undefined;
    let requestedSignal: ShutdownSignal | undefined;
    const stop = (signal: ShutdownSignal): void => {
        if (requestedSignal) {
            return;
        }
        requestedSignal = signal;
        record('cleanup', { signal });
        child.kill(signal);
        timer = setTimeout(() => child.kill('SIGKILL'), shutdownTimeoutMs);
        timer.unref();
    };
    const onInterrupt = (): void => stop('SIGINT');
    const onTerminate = (): void => stop('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    child.once('spawn', () => record('start', { pid: child.pid, root, port }));
    child.once('error', (error: NodeJS.ErrnoException) =>
        record('spawn-error', { code: error.code, message: error.message.replace(command, '<executable>') })
    );
    child.once('close', (code, signal) => {
        if (timer) {
            clearTimeout(timer);
        }
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onTerminate);
        record('exit', { code, signal }, () => {
            if (signal) {
                process.kill(process.pid, signal);
                return;
            }
            process.exitCode = code ?? 1;
        });
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const root = resolve(import.meta.dirname, '..');
    const port = resolveE2ePort(process.argv[2]);
    const vitePackage = fileURLToPath(import.meta.resolve('vite/package.json'));
    runE2eDevServer(root, port, process.execPath, [
        resolve(dirname(vitePackage), 'bin/vite.js'),
        '--mode',
        'e2e',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
    ]);
}
