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
import { FermenterDriveError, FERMENTER_OBSERVATIONS, type FermenterDrive } from '../desktopFermenterEvidence.ts';
import { readPayloadIdentity } from '../desktopLatencyRecord.ts';
import { captureBuildReceipt, runEditorFamilyProof, runProof } from '../proveDesktopFermenter.ts';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
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
    observations.devices.forEach((row, index) => {
        row.instanceId = `device-${index}`;
        row.phase = 'focus-returned';
    });
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
