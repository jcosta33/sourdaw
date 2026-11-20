import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { prepareCrashEvidence, type CrashEvidenceStatus } from './browserAiMacCrashEvidence.ts';
import { resolveE2ePort } from './e2eServerIdentity.ts';

const shutdownTimeoutMs = 3_000;
const admissionPort = 5188;
type ShutdownSignal = 'SIGINT' | 'SIGTERM';
type AdmissionProfile = { reportsDirectory?: string };

export function runE2eDevServer(
    root: string,
    port: number,
    command: string,
    args: string[],
    admission?: AdmissionProfile
): void {
    const runId = randomUUID();
    const record = (event: string, details: Record<string, unknown>, done?: () => void): void => {
        process.stderr.write(
            `${JSON.stringify({ source: 'e2e-dev-server', event, runId, time: new Date().toISOString(), ...details })}\n`,
            done
        );
    };
    const evidence = admission && prepareCrashEvidence(command, admission.reportsDirectory);
    const launchBefore = Date.now();
    const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        // Acceptance documents must survive an editor socket disconnect. The
        // pinned Vite patch also fences its reconnect reload when HMR is off.
        env: admission ? process.env : { ...process.env, NO_HMR: '1' },
    });
    const launchAfter = Date.now();
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
    let exitEvidence: CrashEvidenceStatus | undefined;
    child.once('spawn', () => {
        let launchEvidence: CrashEvidenceStatus | undefined;
        if (evidence === 'unavailable') {
            launchEvidence = evidence;
        } else if (child.pid !== undefined) {
            launchEvidence = evidence?.start(child.pid, launchBefore, launchAfter);
        }
        record('start', admission ? { pid: child.pid, port, launchEvidence } : { pid: child.pid, root, port });
    });
    child.once('error', (error: NodeJS.ErrnoException) =>
        record('spawn-error', { code: error.code, message: error.message.replace(command, '<executable>') })
    );
    child.once('exit', (code, signal) => {
        if (evidence && evidence !== 'unavailable') {
            exitEvidence = evidence.exit(code, signal, requestedSignal !== undefined);
        }
    });
    child.once('close', (code, signal) => {
        if (timer) {
            clearTimeout(timer);
        }
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onTerminate);
        record('exit', { code, signal, exitEvidence }, () => {
            if (signal) {
                process.kill(process.pid, signal);
                return;
            }
            process.exitCode = code ?? 1;
        });
    });
}

export function launchE2eDevServer(
    root: string,
    viteBin: string,
    args: readonly string[],
    admission: AdmissionProfile = {}
): void {
    if (args[0] !== '--browser-ai-admission') {
        const port = resolveE2ePort(args[0]);
        runE2eDevServer(root, port, process.execPath, [
            viteBin,
            '--mode',
            'e2e',
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--strictPort',
        ]);
        return;
    }
    if (args.length !== 1) {
        throw new Error('Browser AI admission does not accept additional server arguments');
    }
    runE2eDevServer(
        root,
        admissionPort,
        process.execPath,
        [viteBin, '--host', '127.0.0.1', '--port', String(admissionPort), '--strictPort'],
        admission
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const root = resolve(import.meta.dirname, '..');
    const vitePackage = fileURLToPath(import.meta.resolve('vite/package.json'));
    launchE2eDevServer(root, resolve(dirname(vitePackage), 'bin/vite.js'), process.argv.slice(2));
}
