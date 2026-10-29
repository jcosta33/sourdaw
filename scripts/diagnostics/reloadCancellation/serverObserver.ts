import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PRIVATE_DIRECTORY } from './identity.ts';
import { createJournal, recordOf, requiredText } from './journal.ts';
import { sampleLinuxResources } from './linuxResources.ts';
import { phaseOutput } from './paths.ts';

export function observeOriginalServer(root: string, output: string, runnerPid: number): void {
    const record = createJournal(resolve(output, 'server-process.jsonl'));
    const probe = pathToFileURL(resolve(root, PRIVATE_DIRECTORY, 'viteTransportProbe.ts')).href;
    const child = spawn(process.execPath, ['scripts/e2eDevServer.ts', '5174'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${probe}`.trim(),
            RELOAD_TRANSPORT_PROBE_OUTPUT: resolve(output, 'vite-transport.jsonl'),
        },
    });
    record('wrapper-spawn', {
        pid: child.pid,
        observerPid: process.pid,
        runnerPid,
        cwd: root,
        argv: child.spawnargs,
        TMPDIR: process.env.TMPDIR,
    });
    let serverPid: number | undefined;
    let buffered = '';
    let stopping = false;
    const observeLine = (line: string): void => {
        try {
            const parsed: unknown = JSON.parse(line);
            const event = recordOf(parsed, 'server event');
            if (event.source !== 'e2e-dev-server') {
                return;
            }
            record('original-server-event', event);
            if (event.event === 'start') {
                if (
                    event.root !== root ||
                    event.port !== 5174 ||
                    typeof event.pid !== 'number' ||
                    !Number.isSafeInteger(event.pid) ||
                    event.pid <= 0
                ) {
                    throw new Error('Original server identity differs');
                }
                serverPid = event.pid;
            }
        } catch (error) {
            if (line.includes('"source":"e2e-dev-server"')) {
                record('server-identity-unknown', String(error));
                child.kill('SIGTERM');
            }
        }
    };
    child.stdout.on('data', (data: Buffer) => {
        appendFileSync(resolve(output, 'server.stdout.log'), data);
        process.stdout.write(data);
    });
    child.stderr.on('data', (data: Buffer) => {
        appendFileSync(resolve(output, 'server.stderr.log'), data);
        process.stderr.write(data);
        buffered += data.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            observeLine(line);
        }
    });
    const sample = (): void => record('linux-resource-sample', sampleLinuxResources(runnerPid, serverPid, root));
    sample();
    const timer = setInterval(sample, 2_000);
    timer.unref();
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.on(signal, () => {
            if (!stopping) {
                stopping = true;
                record('forward-original-cleanup', { signal, wrapperPid: child.pid });
                // The unchanged shared wrapper owns its existing3s escalation and Vite-child cleanup.
                child.kill(signal);
            }
        });
    }
    child.on('error', (error) => record('wrapper-spawn-error', { message: error.message }));
    child.on('close', (code, signal) => {
        clearInterval(timer);
        if (buffered) {
            observeLine(buffered);
        }
        sample();
        record('wrapper-close', { code, signal, serverPid });
        process.exitCode = code ?? 1;
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const runnerPid = Number(process.env.RELOAD_DIAGNOSTIC_RUNNER_PID);
    if (!Number.isSafeInteger(runnerPid) || runnerPid <= 0) {
        throw new Error('Missing diagnostic runner PID');
    }
    observeOriginalServer(requiredText(process.env.RELOAD_DIAGNOSTIC_ROOT, 'target root'), phaseOutput(), runnerPid);
}
