import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    accessSync,
    constants,
    linkSync,
    lstatSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import {
    FermenterDriveError,
    FERMENTER_OBSERVATIONS,
    type FermenterDrive,
    type FermenterObservation,
} from './desktopFermenterEvidence.ts';
import { readPayloadIdentity } from './desktopLatencyRecord.ts';

const APP_PATH = 'release/desktop/mac-arm64/Sourdaw.app';
const EXECUTABLE = 'Contents/MacOS/Sourdaw';
const PAYLOAD_FILES = [
    'Contents/Resources/app.asar',
    'Contents/Resources/sourdaw-native.node',
    'Contents/Resources/sourdaw-plugin-scan-helper',
];
const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const RUN_NUMBER = /^[1-9][0-9]{0,19}$/u;
const MAX_RECEIPT_BYTES = 1024;

type RunIdentity = { sourceSha: string; runId: string; runAttempt: string };
type Digests = { payloadSha256: string; executableSha256: string };
type BuildReceipt = RunIdentity & Digests & { schemaVersion: 1 };
type Options = { checkout: string; app: string; receipt: string };
type ProofPorts = { hostSupported: boolean; drive: FermenterDrive };
type Verdict = 'proven' | 'failed' | 'not-run';
type FailureCode =
    | 'invalid-run-identity'
    | 'unsupported-host'
    | 'checkout-unavailable-or-dirty'
    | 'checkout-sha-mismatch'
    | 'build-receipt-unavailable-or-invalid'
    | 'build-receipt-run-mismatch'
    | 'bundle-unavailable-or-invalid'
    | 'build-receipt-digest-mismatch'
    | FermenterDriveError['code']
    | 'observations-incomplete'
    | 'checkout-changed'
    | 'bundle-changed'
    | 'driver-failed';

type ProofRecord = {
    schemaVersion: 1;
    scope: 'one-packaged-fermenter-popup';
    expected: RunIdentity | null;
    build: BuildReceipt | null;
    observations: FermenterObservation[];
    verdict: Verdict;
    failureCode: FailureCode | null;
};

class FermenterProofError extends Error {
    readonly code: FailureCode;

    constructor(code: FailureCode) {
        super(code);
        this.code = code;
    }
}

function matches(value: unknown, format: RegExp): value is string {
    return typeof value === 'string' && format.test(value);
}

function readRunIdentity(env: NodeJS.ProcessEnv): RunIdentity | null {
    const { GITHUB_SHA: sourceSha, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt } = env;
    if (!matches(sourceSha, COMMIT) || !matches(runId, RUN_NUMBER) || !matches(runAttempt, RUN_NUMBER)) {
        return null;
    }
    return { sourceSha, runId, runAttempt };
}

function checkedHead(checkout: string, expectedSha: string): void {
    const git = (args: string[]): string =>
        execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    let head: string;
    try {
        if (git(['status', '--porcelain', '--untracked-files=no']) !== '') {
            throw new Error('tracked changes');
        }
        head = git(['rev-parse', '--verify', 'HEAD^{commit}']);
    } catch {
        throw new FermenterProofError('checkout-unavailable-or-dirty');
    }
    if (head !== expectedSha) {
        throw new FermenterProofError('checkout-sha-mismatch');
    }
}

function readBuildReceipt(path: string): BuildReceipt {
    try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > MAX_RECEIPT_BYTES) {
            throw new Error('invalid receipt');
        }
        const receipt: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof receipt !== 'object' || receipt === null) {
            throw new Error('invalid receipt');
        }
        const row = receipt as Partial<BuildReceipt>;
        const { schemaVersion, sourceSha, runId, runAttempt, payloadSha256, executableSha256 } = row;
        if (
            schemaVersion === 1 &&
            matches(sourceSha, COMMIT) &&
            matches(runId, RUN_NUMBER) &&
            matches(runAttempt, RUN_NUMBER) &&
            matches(payloadSha256, DIGEST) &&
            matches(executableSha256, DIGEST)
        ) {
            return { schemaVersion, sourceSha, runId, runAttempt, payloadSha256, executableSha256 };
        }
    } catch {
        throw new FermenterProofError('build-receipt-unavailable-or-invalid');
    }
    throw new FermenterProofError('build-receipt-unavailable-or-invalid');
}

function measureBundle(appPath: string): Digests & { binary: string } {
    try {
        if (!lstatSync(appPath).isDirectory()) {
            throw new Error('invalid bundle');
        }
        const app = realpathSync(appPath);
        for (const relative of [EXECUTABLE, ...PAYLOAD_FILES]) {
            const file = join(app, relative);
            const stat = lstatSync(file);
            if (!stat.isFile() || stat.size === 0 || realpathSync(file) !== file) {
                throw new Error('invalid bundle file');
            }
        }
        const binary = join(app, EXECUTABLE);
        accessSync(binary, constants.X_OK);
        const { sha256, files } = readPayloadIdentity(app, 'darwin');
        if (files.join('\n') !== PAYLOAD_FILES.join('\n')) {
            throw new Error('invalid bundle');
        }
        const executableSha256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
        return { binary, payloadSha256: sha256, executableSha256 };
    } catch {
        throw new FermenterProofError('bundle-unavailable-or-invalid');
    }
}

function sameDigests(a: Digests, b: Digests): boolean {
    return a.payloadSha256 === b.payloadSha256 && a.executableSha256 === b.executableSha256;
}

function requireRun(expected: RunIdentity | null, hostSupported: boolean): RunIdentity {
    if (expected === null) {
        throw new FermenterProofError('invalid-run-identity');
    }
    if (!hostSupported) {
        throw new FermenterProofError('unsupported-host');
    }
    return expected;
}

export function captureBuildReceipt(options: Options, env: NodeJS.ProcessEnv, hostSupported: boolean): BuildReceipt {
    const expected = requireRun(readRunIdentity(env), hostSupported);
    checkedHead(options.checkout, expected.sourceSha);
    const { payloadSha256, executableSha256 } = measureBundle(options.app);
    const receipt: BuildReceipt = { schemaVersion: 1, ...expected, payloadSha256, executableSha256 };
    writeFinalJson(options.receipt, receipt);
    return receipt;
}

function admitBuild(options: Options, expected: RunIdentity): { build: BuildReceipt; binary: string } {
    checkedHead(options.checkout, expected.sourceSha);
    const build = readBuildReceipt(options.receipt);
    if (
        build.sourceSha !== expected.sourceSha ||
        build.runId !== expected.runId ||
        build.runAttempt !== expected.runAttempt
    ) {
        throw new FermenterProofError('build-receipt-run-mismatch');
    }
    const measured = measureBundle(options.app);
    if (!sameDigests(measured, build)) {
        throw new FermenterProofError('build-receipt-digest-mismatch');
    }
    return { build, binary: measured.binary };
}

function checkAfterDrive(options: Options, build: BuildReceipt): void {
    try {
        checkedHead(options.checkout, build.sourceSha);
    } catch {
        throw new FermenterProofError('checkout-changed');
    }
    try {
        if (!sameDigests(measureBundle(options.app), build)) {
            throw new Error('digests changed');
        }
    } catch {
        throw new FermenterProofError('bundle-changed');
    }
}

export async function runProof(options: Options, env: NodeJS.ProcessEnv, ports: ProofPorts): Promise<ProofRecord> {
    const expected = readRunIdentity(env);
    const record: ProofRecord = {
        schemaVersion: 1,
        scope: 'one-packaged-fermenter-popup',
        expected,
        build: null,
        observations: [],
        verdict: 'not-run',
        failureCode: null,
    };
    try {
        const run = requireRun(expected, ports.hostSupported);
        if (env.FERMENTER_CAPTURE_OUTCOME !== 'success') {
            throw new FermenterProofError('build-receipt-unavailable-or-invalid');
        }
        const { build, binary } = admitBuild(options, run);
        record.build = build;
        try {
            await ports.drive(binary, (observation) => {
                if (observation !== FERMENTER_OBSERVATIONS[record.observations.length]) {
                    throw new FermenterProofError('observations-incomplete');
                }
                record.observations.push(observation);
            });
        } finally {
            checkAfterDrive(options, build);
        }
        if (record.observations.length !== FERMENTER_OBSERVATIONS.length) {
            throw new FermenterProofError('observations-incomplete');
        }
        return { ...record, verdict: 'proven' };
    } catch (error) {
        const failureCode =
            error instanceof FermenterProofError || error instanceof FermenterDriveError ? error.code : 'driver-failed';
        const verdict = record.build === null || failureCode === 'launch-unavailable' ? 'not-run' : 'failed';
        return { ...record, verdict, failureCode };
    }
}

/** Publish a fully written private file under its final name, without overwriting prior evidence. */
function writeFinalJson(path: string, value: object): void {
    const directory = mkdtempSync(join(dirname(path), '.fermenter-'));
    const temporary = join(directory, 'record.json');
    try {
        writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        linkSync(temporary, path);
    } finally {
        try {
            rmSync(directory, { recursive: true, force: true });
        } catch {
            // The final hard link, once published, remains valid if temp cleanup fails.
        }
    }
}

async function main(): Promise<number> {
    const { values } = parseArgs({
        options: { capture: { type: 'boolean' }, receipt: { type: 'string' }, json: { type: 'string' } },
    });
    const checkout = process.cwd();
    const { capture, receipt, json } = values;
    if (!receipt || (capture ? json !== undefined : !json)) {
        throw new TypeError('Expected either --capture --receipt PATH or --receipt PATH --json PATH');
    }
    const options = { checkout, app: join(checkout, APP_PATH), receipt };
    const hostSupported = process.platform === 'darwin' && process.arch === 'arm64';
    if (capture) {
        captureBuildReceipt(options, process.env, hostSupported);
        process.stdout.write('Captured the Fermenter packaged build receipt.\n');
        return 0;
    }
    const record = await runProof(options, process.env, {
        hostSupported,
        async drive(binary, report) {
            const { driveDesktopFermenter } = await import('./desktopFermenterDrive.ts');
            await driveDesktopFermenter(binary, report);
        },
    });
    writeFinalJson(json, record);
    process.stdout.write(
        `Fermenter packaged proof: ${record.verdict}${record.failureCode ? ` (${record.failureCode})` : ''}.\n`
    );
    return record.verdict === 'proven' ? 0 : record.verdict === 'failed' ? 1 : 2;
}

if (import.meta.main) {
    try {
        process.exitCode = await main();
    } catch (error) {
        const code = error instanceof FermenterProofError ? error.code : 'command-failed';
        process.stderr.write(`Fermenter packaged proof command: not-run (${code}).\n`);
        process.exitCode = 2;
    }
}
