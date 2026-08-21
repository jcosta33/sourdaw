import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { expect, test } from '@playwright/test';

import { terminateChildProcess, withIsolatedElectronUserData } from '../../scripts/electronE2EIsolation';

type Provenance = {
    schemaVersion: 2;
    head: string;
    files: Record<string, string>;
    unpacked: { path: string; state: 'absent' } | { path: string; state: 'present'; files: Record<string, string> };
};
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
const APP_CONTENTS = join(PACKAGED_EXECUTABLE, '..', '..');
const APP_ASAR = join(APP_CONTENTS, 'Resources', 'app.asar');
const INFO_PLIST = join(APP_CONTENTS, 'Info.plist');
const APP_ASAR_UNPACKED = join(APP_CONTENTS, 'Resources', 'app.asar.unpacked');
const DDSP_RUNTIME_LEGAL_FILES = ['Apache-2.0.txt', 'Magenta.js-NOTICE.txt', 'TensorFlow.js-NOTICE.txt'] as const;
const PACKAGED_LEGAL_ROOT = join(APP_CONTENTS, 'Resources', 'legal');
const OUTSIDE_CSP_PROBE_URL =
    'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_2bar_small/config.json';

function digest(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function relativePath(path: string): string {
    return relative(process.cwd(), path).split(sep).join('/');
}

function directoryDigests(directory: string): Record<string, string> {
    const entries: Array<[string, string]> = [];
    const visit = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
            left.name.localeCompare(right.name)
        )) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                visit(path);
                continue;
            }
            const value = lstatSync(path).isSymbolicLink()
                ? createHash('sha256')
                      .update(`symlink:${readlinkSync(path)}`)
                      .digest('hex')
                : digest(path);
            entries.push([relativePath(path), value]);
        }
    };
    visit(directory);
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function assertCurrentPackagedOutput(): void {
    const packagedLegalPaths = DDSP_RUNTIME_LEGAL_FILES.map((name) => join(PACKAGED_LEGAL_ROOT, name));
    for (const path of [PACKAGED_EXECUTABLE, APP_ASAR, INFO_PLIST, ...packagedLegalPaths]) {
        expect(existsSync(path), `${relativePath(path)} must exist`).toBe(true);
    }
    expect(existsSync(PROVENANCE_PATH)).toBe(true);
    const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')) as Provenance;
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    expect(provenance.schemaVersion).toBe(2);
    expect(provenance.head).toBe(head);
    for (const path of [APP_ASAR, INFO_PLIST, PACKAGED_EXECUTABLE, ...packagedLegalPaths]) {
        expect(provenance.files[relativePath(path)]).toBe(digest(path));
    }
    for (const name of DDSP_RUNTIME_LEGAL_FILES) {
        const source = join(process.cwd(), 'public', 'legal', name);
        const packaged = join(PACKAGED_LEGAL_ROOT, name);
        expect(existsSync(source), `${relativePath(source)} must exist`).toBe(true);
        expect(digest(packaged), `${relativePath(packaged)} must match its source legal file`).toBe(digest(source));
    }
    const infoPlist = readFileSync(INFO_PLIST, 'utf8');
    expect(infoPlist).toContain('ElectronAsarIntegrity');
    expect(infoPlist).toContain('Resources/app.asar');

    if (existsSync(APP_ASAR_UNPACKED)) {
        expect(provenance.unpacked).toEqual({
            path: relativePath(APP_ASAR_UNPACKED),
            state: 'present',
            files: directoryDigests(APP_ASAR_UNPACKED),
        });
    } else {
        expect(provenance.unpacked).toEqual({ path: relativePath(APP_ASAR_UNPACKED), state: 'absent' });
    }
}

function productionEnvironment(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'SOURDAW_DESKTOP_DEV'
        )
    );
}

async function assertOutsideTargetIsCorsReadable(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(OUTSIDE_CSP_PROBE_URL, { cache: 'no-store', signal: controller.signal });
        expect(response.ok).toBe(true);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    } finally {
        clearTimeout(timeout);
    }
}

function runPackagedCspProbe(process: ChildProcess): Promise<ProbeResult> {
    return new Promise((resolve, reject) => {
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
    await assertOutsideTargetIsCorsReadable();

    const result = await withIsolatedElectronUserData({
        launch: ({ argument }) =>
            Promise.resolve(
                spawn(PACKAGED_EXECUTABLE, [argument], {
                    env: { ...productionEnvironment(), SOURDAW_DESKTOP_CSP_PROBE: '1' },
                    stdio: ['ignore', 'pipe', 'pipe'],
                })
            ),
        run: runPackagedCspProbe,
        shutdown: terminateChildProcess,
    });

    expect(result).toMatchObject({
        allowed: { resolved: true, ok: true, status: 200 },
        denied: { resolved: false },
        exitCode: 0,
        signal: null,
    });
});
