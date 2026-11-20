// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectBrowserAiMacCrashSummary } from '../browserAiMacCrashSummary';

const start = {
    runId: '9f389442-acef-4d9b-b138-9a4ebf255a43',
    pid: 4188,
    parentPid: 3971,
    executable: '/private/runner-work/matched-tool/node',
    launchBefore: Date.parse('2025-11-18T15:00:00.122Z'),
    launchAfter: Date.parse('2025-11-18T15:00:00.125Z'),
    reportNames: ['stale.ips'],
};
const exit = {
    runId: start.runId,
    pid: start.pid,
    code: 139,
    signal: null,
    planned: false,
    exitedAt: Date.parse('2025-11-18T15:00:07.470Z'),
};
const frame = { imageIndex: 0, imageOffset: 33, symbol: 'rolldown::native_frame', symbolLocation: 5 };
const uuid = '91f686e5-3009-4527-a6ee-67df884caaaf';
const metadata = { bug_type: '309', app_name: 'node', name: 'node' };
const report = {
    pid: start.pid,
    parentPid: start.parentPid,
    procName: 'node',
    procPath: start.executable,
    procLaunch: '2025-11-18 16:00:00.1284 +0100',
    captureTime: '2025-11-18 16:00:07.5238 +0100',
    exception: { signal: 'SIGSEGV' },
    asi: { node: ['private application diagnostics'] },
    faultingThread: 1,
    threads: [
        { frames: [{ ...frame, symbol: 'other_thread' }] },
        {
            registers: ['private registers'],
            frames: [
                frame,
                { ...frame, imageIndex: 1, symbol: '/private/host/path', imageOffset: 17 },
                ...Array.from({ length: 62 }, () => frame),
                { ...frame, symbol: 'beyond_frame_limit' },
            ],
        },
    ],
    usedImages: [
        { name: 'rolldown-binding.darwin-arm64.node', uuid, path: '/private/host/native-binding' },
        { name: '/private/host/path', uuid: 'not-an-image-uuid' },
    ],
};

async function withFixture(
    verify: (fixture: {
        receipt: (name: string, value: object) => void;
        ips: (name: string, data?: object, header?: object) => void;
        home: string;
        reports: string;
        stage: string;
        summary: string;
        collect: (
            waitMs?: number,
            lookupMachOUuid?: (executable: string) => string | undefined
        ) => ReturnType<typeof collectBrowserAiMacCrashSummary>;
    }) => Promise<void>
): Promise<void> {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'sourdaw-webgpu-summary-'));
    const stage = join(root, 'staging');
    const home = join(root, 'test-home');
    const reports = join(home, 'Library', 'Logs', 'DiagnosticReports');
    mkdirSync(stage, { mode: 0o700 });
    mkdirSync(reports, { recursive: true });
    const receipt = (name: string, value: object): void => {
        writeFileSync(join(stage, name), JSON.stringify(value), { mode: 0o600 });
    };
    const ips = (name: string, data: object = report, header: object = metadata): void => {
        writeFileSync(join(reports, name), `${JSON.stringify(header)}\n${JSON.stringify(data)}`);
    };
    try {
        receipt('start.json', start);
        receipt('exit.json', exit);
        await verify({
            receipt,
            ips,
            home,
            reports,
            stage,
            summary: join(stage, 'vite-native-crash.json'),
            collect: (waitMs = 0, lookupMachOUuid) =>
                collectBrowserAiMacCrashSummary(stage, reports, { waitMs, lookupMachOUuid }),
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function expectNoSummary(summary: string): void {
    expect(() => statSync(summary)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
}

describe('Browser AI macOS native crash summary', () => {
    it('stages only the bounded faulting stack, safe identifiers, offsets and times', async () => {
        await withFixture(async ({ ips, summary, collect }) => {
            ips('matched.ips');
            ips('other-process.ips', { ...report, pid: start.pid + 1 });

            expect(await collect()).toBe('saved');
            const serialized = readFileSync(summary, 'utf8');
            const safeFrame = {
                image: 'rolldown-binding.darwin-arm64.node',
                uuid,
                imageOffset: 33,
                symbol: 'rolldown::native_frame',
                symbolLocation: 5,
            };
            expect(JSON.parse(serialized)).toEqual({
                pid: start.pid,
                signal: 'SIGSEGV',
                launchedAt: '2025-11-18T15:00:00.128Z',
                capturedAt: '2025-11-18T15:00:07.523Z',
                exitedAt: '2025-11-18T15:00:07.470Z',
                frames: [safeFrame, { imageOffset: 17 }, ...Array.from({ length: 62 }, () => safeFrame)],
            });
            expect(statSync(summary).mode & 0o777).toBe(0o600);
            expect(serialized).not.toMatch(/private|other_thread|beyond_frame_limit/);
        });
    });

    it('refuses mismatched process identity, metadata and times', async () => {
        await withFixture(async ({ ips, summary, collect }) => {
            ips('wrong-app.ips', report, { ...metadata, app_name: 'Chromium' });
            ips('wrong-name.ips', report, { ...metadata, name: 'Chromium' });
            ips('wrong-bug.ips', report, { ...metadata, bug_type: '288' });
            ips('wrong-pid.ips', { ...report, pid: start.pid + 1 });
            ips('string-pid.ips', { ...report, pid: String(start.pid) });
            ips('wrong-parent.ips', { ...report, parentPid: start.parentPid + 1 });
            ips('wrong-exec.ips', { ...report, procName: 'Chromium' });
            ips('wrong-path.ips', { ...report, procPath: '/redacted/node' });
            ips('wrong-launch.ips', { ...report, procLaunch: '2025-11-18 16:00:00.1200 +0100' });
            ips('late-launch.ips', { ...report, procLaunch: '2025-11-18 16:00:07.5100 +0100' });
            ips('wrong-capture.ips', { ...report, captureTime: '2025-11-18 16:00:12.4720 +0100' });
            ips('before-launch.ips', { ...report, captureTime: '2025-11-18 16:00:00.1000 +0100' });
            ips('wrong-signal.ips', { ...report, exception: { signal: 'SIGTERM' } });
            ips('non-fatal.ips', { ...report, isNonFatal: 'true' });
            ips('simulated.ips', { ...report, isSimulated: true });

            expect(await collect()).toBe('no-matching-report');
            expectNoSummary(summary);
        });
    });

    it('verifies an exactly masked runner-home path against one matching process image and Mach-O UUID', async () => {
        await withFixture(async ({ home, ips, receipt, summary, collect }) => {
            const executable = join(home, 'pinned-tool', 'bin', 'node');
            const maskedPath = join(home, '*', 'node');
            receipt('start.json', { ...start, executable });
            const processImage = { name: 'node', path: maskedPath, uuid, source: 'P' };
            const maskedReport = { ...report, procPath: maskedPath };
            const matching = { ...maskedReport, usedImages: [processImage] };
            const lookupMachOUuid = (observedExecutable: string): string => {
                expect(observedExecutable).toBe(executable);
                return uuid.toUpperCase();
            };
            ips('stale.ips', matching);
            ips('other-home.ips', { ...matching, procPath: '/Users/other-user/*/node' });
            ips('other-path.ips', { ...matching, procPath: join(home, 'other-path', 'node') });
            ips('other-uuid.ips', {
                ...maskedReport,
                usedImages: [{ ...processImage, uuid: '648b325b-91c1-46e4-ad9a-ac4487716558' }],
            });
            ips('other-source.ips', { ...maskedReport, usedImages: [{ ...processImage, source: 'S' }] });
            ips('other-image-path.ips', { ...maskedReport, usedImages: [{ ...processImage, path: executable }] });
            ips('duplicate-image.ips', { ...maskedReport, usedImages: [processImage, processImage] });
            expect(await collect(0, lookupMachOUuid)).toBe('no-matching-report');
            expectNoSummary(summary);

            ips('matching.ips', matching);
            expect(await collect()).toBe('no-matching-report');
            expect(await collect(0, lookupMachOUuid)).toBe('saved');
            expect(readFileSync(summary, 'utf8')).not.toContain(home);
        });
    });

    it('skips prior and unusable candidates without following symlinks or blocking on a FIFO', async () => {
        await withFixture(async ({ ips, reports, summary, collect }) => {
            ips('stale.ips');
            symlinkSync(join(reports, 'stale.ips'), join(reports, 'new-link.ips'));
            expect(spawnSync('mkfifo', [join(reports, 'special.ips')]).status).toBe(0);
            writeFileSync(join(reports, 'malformed.ips'), '{malformed}\n{"abc":1}');
            const valid = readFileSync(join(reports, 'stale.ips'));
            writeFileSync(join(reports, 'oversized.ips'), Buffer.concat([valid, Buffer.alloc(1024 * 1024, ' ')]));
            mkdirSync(join(reports, 'Retired'));
            writeFileSync(join(reports, 'Retired', 'nested.ips'), valid);

            expect(await collect()).toBe('no-matching-report');
            expectNoSummary(summary);
        });
    });

    it('allows time for CrashReporter to publish a matching report after collection starts', async () => {
        await withFixture(async ({ ips, summary, collect }) => {
            const pending = collect(30);
            ips('late.ips');
            expect(await pending).toBe('saved');
            expect(statSync(summary).isFile()).toBe(true);
        });
    });

    it('refuses two identity matches even when one has unusable stack fields', async () => {
        await withFixture(async ({ ips, summary, collect }) => {
            ips('first.ips');
            const pending = collect(30);
            ips('second.ips', { ...report, threads: [] });
            expect(await pending).toBe('ambiguous-report');
            expectNoSummary(summary);
        });
    });

    it('never exports a report for a planned stop, ordinary failure or unpaired launch receipt', async () => {
        await withFixture(async ({ ips, receipt, summary, collect }) => {
            ips('matching.ips');
            receipt('exit.json', { ...exit, planned: true });
            expect(await collect()).toBe('no-unexpected-crash');
            receipt('exit.json', { ...exit, code: 7 });
            expect(await collect()).toBe('no-unexpected-crash');
            receipt('exit.json', { ...exit, runId: 'b228fc69-8b1b-4b27-aa82-be7af216dc7b' });
            expect(await collect()).toBe('missing-crash-evidence');
            expectNoSummary(summary);
            receipt('exit.json', { ...exit, code: null, signal: 'SIGSEGV' });
            expect(await collect()).toBe('saved');
        });
    });

    it('fails closed when the number of new candidates exceeds the read budget', async () => {
        await withFixture(async ({ ips, summary, collect }) => {
            ips('matched.ips');
            for (let index = 0; index < 32; index++) {
                ips(`foreign-${index}.ips`, { ...report, pid: start.pid + 1 });
            }
            expect(await collect()).toBe('report-scan-limit');
            expectNoSummary(summary);
        });
    });
});
