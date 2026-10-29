import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { createJournal, writeReceipt } from './journal.ts';

export async function runPhase(
    root: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    output: string,
    timeoutMs: number
): Promise<number> {
    mkdirSync(output, { recursive: true });
    const record = createJournal(resolve(output, 'process.jsonl'));
    writeReceipt(resolve(output, 'command.json'), {
        command: 'pnpm',
        args,
        cwd: root,
        timeoutMs,
        environment: {
            CI: env.CI,
            E2E_SPECS: env.E2E_SPECS,
            SOURDAW_E2E_PORT: env.SOURDAW_E2E_PORT,
            phase: env.RELOAD_DIAGNOSTIC_PHASE,
        },
    });
    return new Promise((settle) => {
        const child = spawn('pnpm', args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        record('spawn', { pid: child.pid, argv: child.spawnargs });
        let stopping = false;
        let completed = false;
        let escalation: NodeJS.Timeout | undefined;
        const signalGroup = (signal: NodeJS.Signals): void => {
            if (child.pid === undefined) {
                return;
            }
            try {
                process.kill(-child.pid, signal);
                record('owned-process-group-signal', { pid: child.pid, signal });
            } catch (error) {
                record('group-signal-unknown', String(error));
            }
        };
        const stop = (): void => {
            if (!stopping) {
                stopping = true;
                signalGroup('SIGTERM');
                escalation = setTimeout(() => signalGroup('SIGKILL'), 5_000);
            }
        };
        const deadline = setTimeout(() => {
            record('deadline', {});
            stop();
        }, timeoutMs);
        const absoluteEnd = setTimeout(() => {
            record('incomplete-process-close', { pid: child.pid });
            stop();
            finish(1);
        }, timeoutMs + 15_000);
        const finish = (code: number): void => {
            if (completed) {
                return;
            }
            completed = true;
            clearTimeout(deadline);
            clearTimeout(absoluteEnd);
            if (escalation) {
                clearTimeout(escalation);
            }
            process.off('SIGTERM', stop);
            process.off('SIGINT', stop);
            child.stdout.destroy();
            child.stderr.destroy();
            writeReceipt(resolve(output, 'exit.json'), {
                code,
                stopping,
                completeClose: child.exitCode !== null,
                time: new Date().toISOString(),
            });
            settle(code);
        };
        process.on('SIGTERM', stop);
        process.on('SIGINT', stop);
        child.stdout.on('data', (data: Buffer) => appendFileSync(resolve(output, 'stdout.log'), data));
        child.stderr.on('data', (data: Buffer) => appendFileSync(resolve(output, 'stderr.log'), data));
        child.on('error', (error) => {
            record('spawn-error', { message: error.message });
            finish(1);
        });
        child.on('exit', (code, signal) => record('exit', { code, signal }));
        child.on('close', (code, signal) => {
            record('close', { code, signal });
            finish(stopping ? 1 : (code ?? 1));
        });
    });
}
