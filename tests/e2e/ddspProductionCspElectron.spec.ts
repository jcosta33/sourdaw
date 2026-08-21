import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

type Provenance = { head: string; files: Record<string, string> };
type FetchOutcome = { resolved: boolean; ok?: boolean; status?: number; message?: string };
type ProbeResult = {
    allowed: FetchOutcome;
    denied: FetchOutcome;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
};

const PACKAGED_EXECUTABLE = join(
    process.cwd(),
    'release',
    'desktop',
    `mac-${process.arch}`,
    'Sourdaw.app',
    'Contents',
    'MacOS',
    'Sourdaw'
);
const PROVENANCE_PATH = join(process.cwd(), 'release', 'desktop', 'ddsp-csp-e2e-provenance.json');

function digest(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertCurrentPackagedOutput(): void {
    expect(existsSync(PACKAGED_EXECUTABLE)).toBe(true);
    expect(existsSync(PROVENANCE_PATH)).toBe(true);
    const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')) as Provenance;
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    expect(provenance.head).toBe(head);
    expect(provenance.files[`release/desktop/mac-${process.arch}/Sourdaw.app/Contents/MacOS/Sourdaw`]).toBe(
        digest(PACKAGED_EXECUTABLE)
    );
}

function productionEnvironment(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'SOURDAW_DESKTOP_DEV'
        )
    );
}

function runPackagedCspProbe(): Promise<ProbeResult> {
    return new Promise((resolve, reject) => {
        const process = spawn(PACKAGED_EXECUTABLE, [], {
            env: { ...productionEnvironment(), SOURDAW_DESKTOP_CSP_PROBE: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let settled = false;
        const finish = (callback: () => void): void => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                callback();
            }
        };
        const timeout = setTimeout(() => {
            if (!process.killed) {
                process.kill('SIGKILL');
            }
            finish(() => reject(new Error(`packaged CSP probe did not exit within 25 seconds: ${output}`)));
        }, 25_000);
        const collect = (chunk: Buffer): void => {
            output += chunk.toString();
        };
        process.stdout?.on('data', collect);
        process.stderr?.on('data', collect);
        process.once('error', (error) => finish(() => reject(error)));
        process.once('exit', (exitCode, signal) => {
            const match = output.match(/\[shell\] production-csp-probe (\{.+\})/);
            if (match?.[1] === undefined) {
                finish(() => reject(new Error(`packaged CSP probe exited without a result: ${output}`)));
                return;
            }
            try {
                const result = JSON.parse(match[1]) as Omit<ProbeResult, 'exitCode' | 'signal'>;
                finish(() => resolve({ ...result, exitCode, signal }));
            } catch (error) {
                finish(() => reject(new Error(`packaged CSP probe emitted invalid JSON: ${String(error)}\n${output}`)));
            }
        });
    });
}

test('packaged app CSP admits only the exact Magenta DDSP checkpoint path', async ({ browserName: _browserName }) => {
    assertCurrentPackagedOutput();

    const result = await runPackagedCspProbe();

    expect(result).toMatchObject({
        allowed: { resolved: true, ok: true, status: 200 },
        denied: { resolved: false },
        exitCode: 0,
        signal: null,
    });
});
