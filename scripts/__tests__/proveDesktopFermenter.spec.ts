// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type EditorFamilyDrive } from '../desktopEditorFamilyEvidence.ts';
import { driveDesktopEditorWorkspace, runWorkspaceGroups } from '../desktopEditorWorkspaceDrive.ts';
import {
    pausePreservesProgress,
    renderedPlayheadBeat,
    freshWorkspaceObservations,
    type EditorWorkspaceDrive,
    type WorkspaceObservation,
    WORKSPACE_STAGES,
} from '../desktopEditorWorkspaceEvidence.ts';
import { heldReadingsMatch } from '../desktopEditorWorkspacePlayhead.ts';
import { scaleStep } from '../desktopEditorWorkspaceScale.ts';
import * as editorSession from '../desktopFermenterDrive.ts';
import { FermenterDriveError, FERMENTER_OBSERVATIONS, type FermenterDrive } from '../desktopFermenterEvidence.ts';
import { readPayloadIdentity } from '../desktopLatencyRecord.ts';
import {
    captureBuildReceipt,
    runEditorWorkspaceProof,
    runEditorFamilyProof,
    runProof,
    runGrandBouleAuditionProof,
    runCrumbsSamplerProof,
} from '../proveDesktopFermenter.ts';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('bound Crumbs sampler record', () => {
    it('retains capture unavailability after a normal teardown', async () => {
        const { options, env } = fixture();
        const record = await runCrumbsSamplerProof(
            options,
            { ...env, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' },
            {
                hostSupported: true,
                async drive(_binary, observations) {
                    observations.unavailable = 'capture-clock-or-input-unavailable';
                    observations.quits.push({ code: 0, signal: null, forced: false });
                },
            }
        );
        expect(record).toMatchObject({ verdict: 'not-run', failureCode: 'capture-unavailable' });
    });
    it('fails an observed crash even when capture was unavailable', async () => {
        const { options, env } = fixture();
        const record = await runCrumbsSamplerProof(
            options,
            { ...env, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' },
            {
                hostSupported: true,
                async drive(_binary, observations) {
                    observations.unavailable = 'capture-clock-or-input-unavailable';
                    observations.quits.push({ code: null, signal: 'SIGSEGV', forced: false });
                },
            }
        );
        expect(record).toMatchObject({ verdict: 'failed', failureCode: 'crumbs-observations-incomplete' });
    });
    it('fails when teardown throws even if capture was already unavailable', async () => {
        const { options, env } = fixture();
        const record = await runCrumbsSamplerProof(
            options,
            { ...env, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' },
            {
                hostSupported: true,
                async drive(_binary, observations) {
                    observations.unavailable = 'capture-clock-or-input-unavailable';
                    throw new Error('packaged process exit timed out');
                },
            }
        );
        expect(record).toMatchObject({ verdict: 'failed', failureCode: 'driver-failed' });
    });
    it('rejects partial observations after admitting the matching package', async () => {
        const { options, env } = fixture();
        const record = await runCrumbsSamplerProof(
            options,
            { ...env, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' },
            { hostSupported: true, drive: async () => {} }
        );
        expect(record).toMatchObject({
            verdict: 'failed',
            failureCode: 'crumbs-observations-incomplete',
            scope: 'packaged-crumbs-sampler',
        });
    });
    it('rejects a foreign run before driving the package', async () => {
        const { options, env } = fixture();
        const drive = vi.fn();
        const record = await runCrumbsSamplerProof(
            options,
            { ...env, GITHUB_RUN_ATTEMPT: '3' },
            { hostSupported: true, drive }
        );
        expect(record.failureCode).toBe('build-receipt-run-mismatch');
        expect(drive).not.toHaveBeenCalled();
    });
    it('does not drive on a non-scheduled branch', async () => {
        const { options, env } = fixture();
        const drive = vi.fn();
        const record = await runCrumbsSamplerProof(
            options,
            { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' },
            { hostSupported: true, drive }
        );
        expect(record).toMatchObject({ verdict: 'not-run', failureCode: 'crumbs-not-scheduled-main' });
        expect(drive).not.toHaveBeenCalled();
    });
});

const completeDrive: FermenterDrive = async (_binary, report) => {
    for (const observation of FERMENTER_OBSERVATIONS) {
        report(observation);
    }
};

const FAMILY = [
    'Fermenter',
    'Toaster',
    'Levain',
    'Crumbs',
    'Grand Boule',
    'Dutch Oven',
    'Gluten',
    'Bacteria',
    'Grinder',
    'Proof',
    'Scoring',
    'Yeast',
    'Crust',
];

const completeFamilyDrive: EditorFamilyDrive = async (_binary, observations) => {
    for (const [index, row] of observations.devices.entries()) {
        row.instanceId = `device-${index}`;
        row.phase = 'focus-returned';
    }
    observations.lifecycle = {
        firstInstanceId: 'device-9',
        secondInstanceId: 'proof-replacement',
        selectionClosed: true,
        originalReopened: true,
        phase: 'closed',
    };
    observations.appQuit = true;
};

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-fermenter-spec-'));
    tempDirs.push(directory);
    const git = (args: string[]): string =>
        execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
            cwd: directory,
            encoding: 'utf8',
        }).trim();
    git(['init', '--quiet']);
    const tracked = join(directory, 'source.txt');
    writeFileSync(tracked, 'source');
    git(['add', 'source.txt']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    const app = join(directory, 'Sourdaw.app');
    const binary = join(app, 'Contents/MacOS/Sourdaw');
    const addon = join(app, 'Contents/Resources/sourdaw-native.node');
    const scanner = join(app, 'Contents/Resources/sourdaw-plugin-scan-helper');
    const asar = join(app, 'Contents/Resources/app.asar');
    for (const file of [binary, addon, scanner, asar]) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, 'fixture executable or payload', { mode: 0o700 });
    }
    const options = { checkout: directory, app, receipt: join(directory, 'producer.json') };
    const env = {
        GITHUB_SHA: git(['rev-parse', 'HEAD']),
        GITHUB_RUN_ID: '12345678',
        GITHUB_RUN_ATTEMPT: '2',
        FERMENTER_CAPTURE_OUTCOME: 'success',
    };
    const receipt = captureBuildReceipt(options, env, true);
    return { options, receipt, env, tracked, app, binary, addon, scanner, asar };
}

describe('packaged Fermenter proof', () => {
    it('matches the tracked checkout and the producer’s installed package bytes', async () => {
        const { options, env, app, binary } = fixture();
        const drive = vi.fn(completeDrive);
        const record = await runProof(options, env, { hostSupported: true, drive });
        expect(JSON.parse(readFileSync(options.receipt, 'utf8'))).toEqual({
            schemaVersion: 1,
            sourceSha: env.GITHUB_SHA,
            runId: env.GITHUB_RUN_ID,
            runAttempt: env.GITHUB_RUN_ATTEMPT,
            payloadSha256: readPayloadIdentity(app, 'darwin').sha256,
            executableSha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
        });
        expect(drive).toHaveBeenCalledExactlyOnceWith(
            expect.stringMatching(/\/Sourdaw\.app\/Contents\/MacOS\/Sourdaw$/u),
            expect.any(Function)
        );
        expect(record).toMatchObject({
            build: JSON.parse(readFileSync(options.receipt, 'utf8')),
            verdict: 'proven',
            failureCode: null,
            observations: [
                'project-ready',
                'dialog-open-and-focused',
                'transport-play-stop',
                'dialog-closed-and-opener-focused',
                'app-quit',
            ],
        });
    });

    it.each([{ sourceSha: 'c'.repeat(40) }, { runId: '76543210' }, { runAttempt: '1' }])(
        'rejects a producer receipt with foreign provenance %j before driving the app',
        async (change) => {
            const { options, env, receipt } = fixture();
            writeFileSync(options.receipt, JSON.stringify({ ...receipt, ...change }));
            const drive = vi.fn(completeDrive);
            expect(await runProof(options, env, { hostSupported: true, drive })).toMatchObject({
                verdict: 'not-run',
                failureCode: 'build-receipt-run-mismatch',
                build: null,
                observations: [],
            });
            expect(drive).not.toHaveBeenCalled();
        }
    );

    it('rejects a different expected checkout and a dirty producer checkout', async () => {
        const { options, env, tracked } = fixture();
        const drive = vi.fn(completeDrive);
        const invalidSha = { ...env, GITHUB_SHA: 'c'.repeat(40) };
        expect(await runProof(options, invalidSha, { hostSupported: true, drive })).toMatchObject({
            verdict: 'not-run',
            failureCode: 'checkout-sha-mismatch',
        });
        writeFileSync(tracked, 'dirty');
        expect(() => captureBuildReceipt(options, env, true)).toThrow('checkout-unavailable-or-dirty');
        expect(await runProof(options, env, { hostSupported: true, drive })).toMatchObject({
            verdict: 'not-run',
            failureCode: 'checkout-unavailable-or-dirty',
        });
        expect(drive).not.toHaveBeenCalled();
    });

    it('writes an unavailable proof as finalized JSON and returns exit 2 through the native Node entry point', () => {
        const { options, env } = fixture();
        const output = join(options.checkout, 'proof.json');
        const script = fileURLToPath(new URL('../proveDesktopFermenter.ts', import.meta.url));
        const run = spawnSync(process.execPath, [script, '--receipt', options.receipt, '--json', output], {
            cwd: options.checkout,
            env: { ...process.env, ...env, GITHUB_SHA: '' },
            encoding: 'utf8',
        });
        expect(run.status).toBe(2);
        expect(run.stdout).toContain('Fermenter packaged proof: not-run (invalid-run-identity).');
        expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
            schemaVersion: 1,
            scope: 'one-packaged-fermenter-popup',
            expected: null,
            build: null,
            observations: [],
            verdict: 'not-run',
            failureCode: 'invalid-run-identity',
        });
    });

    it('requires successful capture in this job even if a matching file exists', async () => {
        const { options, env } = fixture();
        const drive = vi.fn(completeDrive);
        expect(
            await runProof(options, { ...env, FERMENTER_CAPTURE_OUTCOME: 'failure' }, { hostSupported: true, drive })
        ).toMatchObject({ verdict: 'not-run', failureCode: 'build-receipt-unavailable-or-invalid' });
        expect(drive).not.toHaveBeenCalled();
    });

    it('rejects an oversized receipt even if its JSON and provenance are valid', async () => {
        const { options, env, receipt } = fixture();
        writeFileSync(options.receipt, `${JSON.stringify(receipt)}${' '.repeat(1024)}`);
        const drive = vi.fn(completeDrive);
        expect(await runProof(options, env, { hostSupported: true, drive })).toMatchObject({
            verdict: 'not-run',
            failureCode: 'build-receipt-unavailable-or-invalid',
        });
        expect(drive).not.toHaveBeenCalled();
    });

    it('rejects a receipt symlink with matching bytes and provenance', async () => {
        const { options, env } = fixture();
        const regularReceipt = join(options.checkout, 'regular-receipt.json');
        renameSync(options.receipt, regularReceipt);
        symlinkSync(regularReceipt, options.receipt);
        const drive = vi.fn(completeDrive);
        expect(await runProof(options, env, { hostSupported: true, drive })).toMatchObject({
            verdict: 'not-run',
            failureCode: 'build-receipt-unavailable-or-invalid',
        });
        expect(drive).not.toHaveBeenCalled();
    });

    it('rejects a bundle executable with unchanged bytes and no execute permission', async () => {
        const { options, env, binary } = fixture();
        chmodSync(binary, 0o600);
        const drive = vi.fn(completeDrive);
        expect(await runProof(options, env, { hostSupported: true, drive })).toMatchObject({
            verdict: 'not-run',
            failureCode: 'bundle-unavailable-or-invalid',
        });
        expect(drive).not.toHaveBeenCalled();
    });

    it.each(['asar', 'addon', 'scanner', 'binary'] as const)(
        'rejects changed %s bytes before launch',
        async (component) => {
            const fixtureFiles = fixture();
            const { options, env } = fixtureFiles;
            writeFileSync(fixtureFiles[component], 'other bytes');
            const drive = vi.fn(completeDrive);
            expect(await runProof(options, env, { hostSupported: true, drive })).toMatchObject({
                verdict: 'not-run',
                failureCode: 'build-receipt-digest-mismatch',
            });
            expect(drive).not.toHaveBeenCalled();
        }
    );

    it('rejects a linked installed component even when it resolves to the original bytes', async () => {
        const { options, env, addon, scanner } = fixture();
        unlinkSync(scanner);
        symlinkSync(addon, scanner);
        const drive = vi.fn(completeDrive);
        expect(await runProof(options, env, { hostSupported: true, drive })).toMatchObject({
            verdict: 'not-run',
            failureCode: 'bundle-unavailable-or-invalid',
        });
        expect(drive).not.toHaveBeenCalled();
    });

    it('keeps partial observations when the next UI step fails', async () => {
        const { options, env } = fixture();
        const record = await runProof(options, env, {
            hostSupported: true,
            async drive(_binary, report) {
                report('project-ready');
                throw new FermenterDriveError('dialog-open-failed');
            },
        });
        expect(record).toMatchObject({
            verdict: 'failed',
            failureCode: 'dialog-open-failed',
            observations: ['project-ready'],
        });
    });

    it.each([0, 4])('rejects a driver that returns after %i observations', async (count) => {
        const { options, env } = fixture();
        const record = await runProof(options, env, {
            hostSupported: true,
            async drive(_binary, report) {
                for (const observation of FERMENTER_OBSERVATIONS.slice(0, count)) {
                    report(observation);
                }
            },
        });
        expect(record).toMatchObject({ verdict: 'failed', failureCode: 'observations-incomplete' });
    });

    it('rejects an unavailable launch without passing exception text into the record', async () => {
        const { options, env } = fixture();
        const error = new FermenterDriveError('launch-unavailable');
        error.message = 'unstructured runner diagnostic';
        const record = await runProof(options, env, { hostSupported: true, drive: async () => Promise.reject(error) });
        expect(record).toMatchObject({ verdict: 'not-run', failureCode: 'launch-unavailable', observations: [] });
        expect(JSON.stringify(record)).not.toContain(error.message);
    });

    it.each([
        ['addon', 'bundle-changed'],
        ['tracked', 'checkout-changed'],
    ] as const)('checks %s again after the driver settles', async (component, failureCode) => {
        const fixtureFiles = fixture();
        const { options, env } = fixtureFiles;
        const record = await runProof(options, env, {
            hostSupported: true,
            async drive(binary, report) {
                await completeDrive(binary, report);
                writeFileSync(fixtureFiles[component], 'changed during the proof');
            },
        });
        expect(record).toMatchObject({ verdict: 'failed', failureCode, observations: [...FERMENTER_OBSERVATIONS] });
    });
});

describe('packaged editor family proof', () => {
    it('binds the complete family and lifecycle to the existing build receipt', async () => {
        const { options, env, receipt, binary } = fixture();
        const drive = vi.fn(completeFamilyDrive);
        const record = await runEditorFamilyProof(options, env, { hostSupported: true, drive });
        expect(drive).toHaveBeenCalledExactlyOnceWith(binary, record.observations);
        expect(record).toMatchObject({
            scope: 'packaged-premium-editor-mount-and-lifecycle',
            build: receipt,
            verdict: 'proven',
            failureCode: null,
        });
        expect(record.observations.devices.map((row) => row.device)).toEqual(FAMILY);
        expect(record.observations.devices.find((row) => row.device === 'Crumbs')).toEqual({
            device: 'Crumbs',
            navigation: 'instrument',
            dialog: 'Sampler',
            editorControl: 'Ready',
            instanceId: 'device-3',
            phase: 'focus-returned',
            failure: null,
        });
    });

    it('keeps the missing sampler admission and later results without awarding family credit', async () => {
        const { options, env } = fixture();
        const record = await runEditorFamilyProof(options, env, {
            hostSupported: true,
            async drive(binary, observations) {
                await completeFamilyDrive(binary, observations);
                Object.assign(observations.devices[3]!, {
                    instanceId: null,
                    phase: 'not-attempted',
                    failure: 'card-unavailable',
                });
            },
        });
        expect(record).toMatchObject({ verdict: 'failed', failureCode: 'device-observations-incomplete' });
        expect(record.observations.devices.map((row) => row.device)).toEqual(FAMILY);
        expect(record.observations.devices[3]).toMatchObject({ device: 'Crumbs', failure: 'card-unavailable' });
        expect(record.observations.devices.at(-1)).toMatchObject({ device: 'Crust', phase: 'focus-returned' });
    });

    it('rejects a driver that closes the original Proof instance without replacing it', async () => {
        const { options, env } = fixture();
        const record = await runEditorFamilyProof(options, env, {
            hostSupported: true,
            async drive(binary, observations) {
                await completeFamilyDrive(binary, observations);
                observations.lifecycle!.secondInstanceId = observations.lifecycle!.firstInstanceId;
            },
        });
        expect(record).toMatchObject({ verdict: 'failed', failureCode: 'lifecycle-observation-incomplete' });
    });

    it('refuses a previous attempt before launching the family driver', async () => {
        const { options, env } = fixture();
        const drive = vi.fn(completeFamilyDrive);
        const record = await runEditorFamilyProof(
            options,
            { ...env, GITHUB_RUN_ATTEMPT: '3' },
            {
                hostSupported: true,
                drive,
            }
        );
        expect(drive).not.toHaveBeenCalled();
        expect(record).toMatchObject({
            verdict: 'not-run',
            failureCode: 'build-receipt-run-mismatch',
            build: null,
        });
        expect(record.observations.devices.map((row) => row.phase)).toEqual(FAMILY.map(() => 'not-attempted'));
    });

    it('invalidates a completed family observation if the runner changes the packaged payload', async () => {
        const { options, env, asar } = fixture();
        const record = await runEditorFamilyProof(options, env, {
            hostSupported: true,
            async drive(binary, observations) {
                await completeFamilyDrive(binary, observations);
                writeFileSync(asar, 'changed during the proof');
            },
        });
        expect(record).toMatchObject({ verdict: 'failed', failureCode: 'bundle-changed' });
        expect(record.observations.devices).toHaveLength(13);
    });

    it('writes the family record and returns exit 2 through its scheduled CLI mode', () => {
        const { options, env } = fixture();
        const output = join(options.checkout, 'family.json');
        const script = fileURLToPath(new URL('../proveDesktopFermenter.ts', import.meta.url));
        const run = spawnSync(process.execPath, [script, '--family', '--receipt', options.receipt, '--json', output], {
            cwd: options.checkout,
            env: { ...process.env, ...env, GITHUB_SHA: '' },
            encoding: 'utf8',
        });
        expect(run.status).toBe(2);
        expect(run.stdout).toContain('Premium editor family packaged proof: not-run (invalid-run-identity).');
        const record = JSON.parse(readFileSync(output, 'utf8'));
        expect(record).toMatchObject({
            scope: 'packaged-premium-editor-mount-and-lifecycle',
            verdict: 'not-run',
            failureCode: 'invalid-run-identity',
        });
        expect(record.observations.devices.map(({ device }: { device: string }) => device)).toEqual(FAMILY);
    });
});

const completeWorkspaceDrive: EditorWorkspaceDrive = async (_binary, observations) => {
    for (const row of observations.stages) {
        row.outcome = 'passed';
    }
    const row = observations.stages.find(({ stage }) => stage === 'timeline-transport');
    if (!row) {
        throw new Error('missing timeline');
    }
    row.timeline = {
        samples: {
            before: 0,
            sought: 7,
            advancing: 7.5,
            advanced: 8,
            pauseClick: 8,
            paused: 8.1,
            pauseHold: 2,
            stopped: 0,
            stopHold: 2,
        },
        pauseCapture: { trusted: true, ageMs: 30, clickTimeMs: 1000 },
        trackBefore: 'track-1',
        trackAfter: 'track-1',
        deviceBefore: 'device-1',
        deviceAfter: 'device-1',
    };
    observations.appQuit = true;
};

describe('packaged editor workspace proof', () => {
    it.each([
        [['Bars3.1.000', 'Bars3.1.000'], true],
        [['Bars2.4.240', 'Bars2.4.240'], false],
        [['Bars3.1.000', 'Bars3.1.001'], false],
        [['Bars3.1.000'], false],
    ] as const)('requires the expected beat throughout the hold window: %s', (values, expected) => {
        expect(heldReadingsMatch([...values], 8)).toBe(expected);
    });
    it('rejects passed stage flags when timeline evidence is missing', async () => {
        const { options, env } = fixture();
        const record = await runEditorWorkspaceProof(options, env, {
            hostSupported: true,
            async drive(binary, observations) {
                await completeWorkspaceDrive(binary, observations);
                const row = observations.stages.find(({ stage }) => stage === 'timeline-transport');
                if (!row) {
                    throw new Error('missing timeline');
                }
                delete row.timeline;
            },
        });
        expect(record.verdict).toBe('failed');
        expect(record.failureCode).toBe('workspace-observations-incomplete');
    });
    it.each([
        [
            'missing click capture',
            (timeline) => {
                delete timeline.pauseCapture;
            },
        ],
        [
            'untrusted click',
            (timeline) => {
                timeline.pauseCapture = { trusted: false, ageMs: 30, clickTimeMs: 1000 };
            },
        ],
        [
            'stale click readout',
            (timeline) => {
                timeline.pauseCapture = { trusted: true, ageMs: 125.01, clickTimeMs: 1000 };
            },
        ],
        [
            'missing click age',
            (timeline) => {
                timeline.pauseCapture = { trusted: true, ageMs: null, clickTimeMs: 1000 };
            },
        ],
        [
            'missing sample',
            (timeline) => {
                delete timeline.samples.advanced;
            },
        ],
        [
            'non-finite sample',
            (timeline) => {
                timeline.samples.before = NaN;
            },
        ],
        [
            'seek outside tolerance',
            (timeline) => {
                timeline.samples.sought = 7.03;
            },
        ],
        [
            'no seek',
            (timeline) => {
                timeline.samples.before = 7;
            },
        ],
        [
            'no first advance',
            (timeline) => {
                timeline.samples.advancing = 7.25;
            },
        ],
        [
            'no second advance',
            (timeline) => {
                timeline.samples.advanced = 7.75;
            },
        ],
        [
            'pause outside tolerance',
            (timeline) => {
                timeline.samples.paused = 8.3;
            },
        ],
        [
            'short pause hold',
            (timeline) => {
                timeline.samples.pauseHold = 1;
            },
        ],
        [
            'stop not zero',
            (timeline) => {
                timeline.samples.stopped = 1;
            },
        ],
        [
            'short stop hold',
            (timeline) => {
                timeline.samples.stopHold = 1;
            },
        ],
        [
            'changed track',
            (timeline) => {
                timeline.trackAfter = 'track-2';
            },
        ],
        [
            'changed device',
            (timeline) => {
                timeline.deviceAfter = 'device-2';
            },
        ],
        [
            'missing device',
            (timeline) => {
                delete timeline.deviceBefore;
            },
        ],
    ] satisfies [string, (timeline: NonNullable<WorkspaceObservation['timeline']>) => void][])(
        'rejects incomplete timeline evidence: %s',
        async (_name, change) => {
            const { options, env } = fixture();
            const record = await runEditorWorkspaceProof(options, env, {
                hostSupported: true,
                async drive(binary, observations) {
                    await completeWorkspaceDrive(binary, observations);
                    const timeline = observations.stages.find(({ stage }) => stage === 'timeline-transport')?.timeline;
                    if (!timeline) {
                        throw new Error('missing timeline');
                    }
                    change(timeline);
                },
            });
            expect(record).toMatchObject({ verdict: 'failed', failureCode: 'workspace-observations-incomplete' });
        }
    );
    it('keeps the first scale failure while admitting timeline in a fresh session', async () => {
        const visited: string[] = [];
        const observations = freshWorkspaceObservations();
        const scale = observations.stages.find(({ stage }) => stage === 'scale-refit')!;
        const timeline = observations.stages.find(({ stage }) => stage === 'timeline-transport')!;
        const result = await runWorkspaceGroups(
            async (name) => {
                visited.push(name);
                if (name === 'geometry') {
                    scale.outcome = 'failed';
                    await scaleStep(scale, 'close-click', async () => {
                        throw new Error('scale-refit');
                    });
                }
                if (name === 'timeline') {
                    timeline.outcome = 'passed';
                }
            },
            () => true
        );
        expect(visited).toEqual(['geometry', 'timeline', 'nested-escape', 'remove-instance']);
        expect(result).toBe(true);
        expect(scale).toMatchObject({
            outcome: 'failed',
            scaleSteps: [{ name: 'close-click', outcome: 'failed' }],
        });
        expect(timeline.outcome).toBe('passed');
    });
    it.each([
        ['BARS\n1\n.\n1\n.\n000', 0],
        ['Bars2.4.000', 7],
        ['Bars 3 . 2 . 240', 9.5],
        ['00:00:01.000', null],
        ['Bars1.5.000', null],
        ['Bars1.1.480', null],
        ['Bars0.1.000', null],
        ['Bars1.1.000garbage', null],
    ] as const)('reads the rendered musical display %s', (text, expected) => {
        expect(renderedPlayheadBeat(text)).toBe(expected);
    });

    it.each([
        { label: 'missing witness', clickReadout: null, paused: 8, verdict: 'failed' },
        { label: 'undefined witness', clickReadout: undefined, paused: 8, verdict: 'failed' },
        { label: 'malformed witness', clickReadout: 'unknown', paused: 8, verdict: 'failed' },
        { label: 'invalid tick witness', clickReadout: 'Bars3.1.480', paused: 8, verdict: 'failed' },
        { label: 'rewound click witness', clickReadout: 'Bars2.4.000', paused: 8, verdict: 'failed' },
        { label: 'reset to zero', clickReadout: 'Bars3.1.000', paused: 0, verdict: 'failed' },
        { label: 'rewind to seek', clickReadout: 'Bars3.1.000', paused: 7, verdict: 'failed' },
        { label: 'two-tick rewind', clickReadout: 'Bars3.1.000', paused: 8 - 2 / 480, verdict: 'failed' },
        { label: 'one-tick quantization', clickReadout: 'Bars3.1.000', paused: 8 - 1 / 480, verdict: 'proven' },
        { label: 'same displayed position', clickReadout: 'Bars3.1.000', paused: 8, verdict: 'proven' },
        { label: 'small forward jitter', clickReadout: 'BARS\n3\n.\n1\n.\n000', paused: 8.1, verdict: 'proven' },
        { label: 'quarter-beat cadence bound', clickReadout: 'Bars3.1.000', paused: 8.25, verdict: 'proven' },
        {
            label: 'one tick beyond cadence bound',
            clickReadout: 'Bars3.1.000',
            paused: 8 + 121 / 480,
            verdict: 'failed',
        },
        { label: 'forward jump eight to sixteen', clickReadout: 'Bars3.1.000', paused: 16, verdict: 'failed' },
        { label: 'advance before actual click', clickReadout: 'Bars3.2.000', paused: 9.1, verdict: 'proven' },
        {
            label: 'one-tick rewind from progressed click',
            clickReadout: 'Bars3.2.000',
            paused: 9 - 1 / 480,
            verdict: 'proven',
        },
        {
            label: 'two-tick rewind from progressed click',
            clickReadout: 'Bars3.2.000',
            paused: 9 - 2 / 480,
            verdict: 'failed',
        },
        {
            label: 'click two ticks behind latest advance with valid parking',
            clickReadout: 'Bars2.4.478',
            paused: 8,
            verdict: 'failed',
        },
        {
            label: 'cumulative one-tick rewinds exceed latest advance allowance',
            clickReadout: 'Bars2.4.479',
            paused: 8 - 2 / 480,
            verdict: 'failed',
        },
        { label: 'rewind from actual click', clickReadout: 'Bars3.2.000', paused: 8.25, verdict: 'failed' },
    ] as const)(
        'requires valid click-bound parking for $label before proof can be $verdict',
        async ({ clickReadout, paused, verdict }) => {
            const { options, env } = fixture();
            const record = await runEditorWorkspaceProof(options, env, {
                hostSupported: true,
                async drive(binary, observations) {
                    await completeWorkspaceDrive(binary, observations);
                    const row = observations.stages.find(({ stage }) => stage === 'timeline-transport');
                    if (!row) {
                        throw new Error('missing fixture stage');
                    }
                    row.outcome = 'failed';
                    row.values.push({ before: 0, sought: 7, advancing: 7.5, advanced: 8, paused });
                    if (!pausePreservesProgress(8, clickReadout, paused)) {
                        throw new Error('Pause did not park at its click position');
                    }
                    row.outcome = 'passed';
                },
            });
            expect(record.verdict).toBe(verdict);
            expect(record.failureCode).toBe(verdict === 'failed' ? 'driver-failed' : null);
            expect(record.observations.stages.find(({ stage }) => stage === 'timeline-transport')).toMatchObject({
                outcome: verdict === 'failed' ? 'failed' : 'passed',
                values: [{ before: 0, sought: 7, advancing: 7.5, advanced: 8, paused }],
            });
        }
    );

    it('reports launch-unavailable without teardown credit when all four isolated sessions refuse launch', async () => {
        const { options, env } = fixture();
        const launch = vi
            .spyOn(editorSession, 'launchEditorSession')
            .mockRejectedValue(new FermenterDriveError('launch-unavailable'));
        const quit = vi.spyOn(editorSession, 'quitEditorSession');
        try {
            const record = await runEditorWorkspaceProof(options, env, {
                hostSupported: true,
                drive: driveDesktopEditorWorkspace,
            });
            expect(launch).toHaveBeenCalledTimes(4);
            expect(quit).not.toHaveBeenCalled();
            expect(record).toMatchObject({
                verdict: 'not-run',
                failureCode: 'launch-unavailable',
                observations: { appQuit: false },
            });
            expect(record.observations.stages.filter(({ outcome }) => outcome === 'passed')).toEqual([]);
            expect(
                record.observations.stages.filter(({ outcome }) => outcome === 'failed').map(({ stage }) => stage)
            ).toEqual(['workspace-ready', 'timeline-transport', 'nested-escape', 'remove-instance']);
        } finally {
            launch.mockRestore();
            quit.mockRestore();
        }
    });

    it('refuses missing teardown even when every workspace observation passed', async () => {
        const { options, env } = fixture();
        const record = await runEditorWorkspaceProof(options, env, {
            hostSupported: true,
            async drive(binary, observations) {
                await completeWorkspaceDrive(binary, observations);
                observations.appQuit = false;
            },
        });
        expect(record).toMatchObject({ verdict: 'failed', failureCode: 'quit-failed' });
    });

    it('binds the separate complete workspace record to the frozen packaged build', async () => {
        const { options, env, receipt } = fixture();
        const record = await runEditorWorkspaceProof(options, env, {
            hostSupported: true,
            drive: completeWorkspaceDrive,
        });
        expect(record).toMatchObject({
            verdict: 'proven',
            failureCode: null,
            build: receipt,
            scope: 'packaged-premium-editor-workspace',
        });
        expect(record.observations.stages.map(({ stage, outcome }) => ({ stage, outcome }))).toEqual(
            WORKSPACE_STAGES.map((stage) => ({ stage, outcome: 'passed' }))
        );
    });

    it.each(['failed', 'not-reached'] as const)(
        'refuses a %s stage even after the driver returns normally',
        async (outcome) => {
            const { options, env } = fixture();
            const record = await runEditorWorkspaceProof(options, env, {
                hostSupported: true,
                async drive(binary, observations) {
                    await completeWorkspaceDrive(binary, observations);
                    const stage = observations.stages.find(({ stage }) => stage === 'title-drag');
                    if (!stage) {
                        throw new Error('missing fixture stage');
                    }
                    stage.outcome = outcome;
                },
            });
            expect(record.verdict).toBe('failed');
            expect(record.failureCode).toBe('workspace-observations-incomplete');
            expect(record.observations.stages[4]).toMatchObject({ stage: 'title-drag', outcome });
        }
    );

    it('retains passed, failed and unreached stages separately after an interrupted driver', async () => {
        const { options, env } = fixture();
        const record = await runEditorWorkspaceProof(options, env, {
            hostSupported: true,
            async drive(_binary, observations) {
                for (const row of observations.stages) {
                    if (row.stage === 'workspace-ready') {
                        row.outcome = 'passed';
                    }
                    if (row.stage === 'initial-placement') {
                        row.outcome = 'failed';
                    }
                }
                observations.appQuit = true;
                throw new Error('fixture observation failed');
            },
        });
        expect(record.verdict).toBe('failed');
        expect(record.failureCode).toBe('driver-failed');
        expect(record.observations.stages.map(({ outcome }) => outcome)).toEqual([
            'passed',
            'failed',
            ...WORKSPACE_STAGES.slice(2).map(() => 'not-reached'),
        ]);
    });

    it.each(['source', 'binary', 'payload'] as const)(
        'refuses post-observation %s drift after all stages pass',
        async (target) => {
            const { options, env, tracked, binary, asar } = fixture();
            const record = await runEditorWorkspaceProof(options, env, {
                hostSupported: true,
                async drive(executable, observations) {
                    await completeWorkspaceDrive(executable, observations);
                    const targets = { source: tracked, binary, payload: asar };
                    writeFileSync(targets[target], 'drifted fixture');
                },
            });
            expect(record.verdict).toBe('failed');
            expect(record.failureCode).toBe(target === 'source' ? 'checkout-changed' : 'bundle-changed');
        }
    );

    it('leaves every stage unreached when capture admission fails', async () => {
        const { options, env } = fixture();
        const drive = vi.fn(completeWorkspaceDrive);
        const record = await runEditorWorkspaceProof(
            options,
            { ...env, FERMENTER_CAPTURE_OUTCOME: 'failure' },
            { hostSupported: true, drive }
        );
        expect(record.verdict).toBe('not-run');
        expect(record.failureCode).toBe('build-receipt-unavailable-or-invalid');
        expect(drive).not.toHaveBeenCalled();
        expect(record.observations.stages.every(({ outcome }) => outcome === 'not-reached')).toBe(true);
    });

    it('writes only the workspace record for the workspace CLI mode on invalid admission', () => {
        const { options, env } = fixture();
        const output = join(options.checkout, 'workspace.json');
        const run = spawnSync(
            process.execPath,
            [
                fileURLToPath(new URL('../proveDesktopFermenter.ts', import.meta.url)),
                '--workspace',
                '--receipt',
                options.receipt,
                '--json',
                output,
            ],
            {
                cwd: options.checkout,
                env: { ...process.env, ...env, GITHUB_SHA: 'invalid' },
                encoding: 'utf8',
            }
        );
        expect(run.status).toBe(2);
        expect(run.stdout).toContain('Premium editor workspace packaged proof: not-run (invalid-run-identity).');
        const record = JSON.parse(readFileSync(output, 'utf8'));
        expect(record).toMatchObject({ verdict: 'not-run', scope: 'packaged-premium-editor-workspace' });
        expect(record.observations.stages).toHaveLength(WORKSPACE_STAGES.length);
    });
});

describe('bound Grand Boule audition record', () => {
    it('retains an unavailable capture with the admitted build and source identity', async () => {
        const { options, env } = fixture();
        const record = await runGrandBouleAuditionProof(options, env, {
            hostSupported: true,
            async drive(_binary, o) {
                o.unavailable = 'permission-or-capture-unavailable';
                o.appQuit = true;
            },
        });
        expect(record).toMatchObject({
            verdict: 'not-run',
            failureCode: 'capture-unavailable',
            scope: 'packaged-grand-boule-output-audition',
            build: { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT },
        });
    });
    it('refuses a foreign receipt without invoking the audition', async () => {
        const { options, env } = fixture();
        const drive = vi.fn();
        const record = await runGrandBouleAuditionProof(
            options,
            { ...env, GITHUB_RUN_ATTEMPT: '3' },
            { hostSupported: true, drive }
        );
        expect(record.failureCode).toBe('build-receipt-run-mismatch');
        expect(drive).not.toHaveBeenCalled();
    });
});
