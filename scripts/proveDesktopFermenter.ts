import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    accessSync,
    closeSync,
    constants,
    fstatSync,
    linkSync,
    lstatSync,
    mkdtempSync,
    openSync,
    readSync,
    realpathSync,
    rmSync,
    writeFileSync,
    type BigIntStats,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import {
    crumbsSamplerFailure,
    freshCrumbsSamplerObservations,
    type CrumbsSamplerObservations,
} from './desktopCrumbsSamplerEvidence.ts';
import {
    familyFailure,
    freshFamilyObservations,
    type EditorFamilyDrive,
    type FamilyObservations,
} from './desktopEditorFamilyEvidence.ts';
import {
    freshWorkspaceObservations,
    workspaceFailure,
    type EditorWorkspaceDrive,
    type WorkspaceObservations,
} from './desktopEditorWorkspaceEvidence.ts';
import {
    FermenterDriveError,
    FERMENTER_OBSERVATIONS,
    type FermenterDrive,
    type FermenterObservation,
} from './desktopFermenterEvidence.ts';
import {
    auditionFailure,
    freshAuditionObservations,
    type AuditionObservations,
} from './desktopGrandBouleAuditionEvidence.ts';
import { digestPayloadComponents, payloadRelativePaths } from './desktopLatencyRecord.ts';

const APP_PATH = 'release/desktop/mac-arm64/Sourdaw.app';
const EXECUTABLE = 'Contents/MacOS/Sourdaw';
const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const RUN_NUMBER = /^[1-9][0-9]{0,19}$/u;
const MAX_RECEIPT_BYTES = 1024;
const USAGE =
    'Expected either --capture --receipt PATH or [--family | --workspace | --audition | --crumbs] --receipt PATH --json PATH';

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
    | NonNullable<ReturnType<typeof familyFailure>>
    | NonNullable<ReturnType<typeof workspaceFailure>>
    | NonNullable<ReturnType<typeof auditionFailure>>
    | 'crumbs-observations-incomplete'
    | 'crumbs-control-invalid'
    | 'crumbs-audio-invalid'
    | 'crumbs-not-scheduled-main'
    | 'checkout-changed'
    | 'bundle-changed'
    | 'driver-failed';

type BoundRecord = {
    schemaVersion: 1;
    expected: RunIdentity | null;
    build: BuildReceipt | null;
    verdict: Verdict;
    failureCode: FailureCode | null;
};

type ProofRecord = BoundRecord & {
    scope: 'one-packaged-fermenter-popup';
    observations: FermenterObservation[];
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

type FileAdmission = { maxBytes?: number; canonical?: boolean; executable?: boolean };

function sameFileSnapshot(before: BigIntStats, after: BigIntStats): boolean {
    return (
        after.isFile() &&
        after.dev === before.dev &&
        after.ino === before.ino &&
        after.size === before.size &&
        after.mtimeNs === before.mtimeNs &&
        after.ctimeNs === before.ctimeNs
    );
}

function readExpectedBytes(fd: number, size: number): Buffer {
    const buffer = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < buffer.length) {
        const count = readSync(fd, buffer, offset, buffer.length - offset, null);
        if (count === 0) {
            break;
        }
        offset += count;
    }
    if (offset !== size) {
        throw new Error('file length changed while reading');
    }
    return buffer.subarray(0, size);
}

function readStableRegularFile(path: string, options: FileAdmission): Buffer {
    if (!(constants.O_NOFOLLOW > 0) || !(constants.O_NONBLOCK > 0)) {
        throw new Error('safe file open flags are unavailable');
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = fstatSync(fd, { bigint: true });
        const size = Number(before.size);
        if (!before.isFile() || size <= 0 || !Number.isSafeInteger(size) || size > (options.maxBytes ?? Infinity)) {
            throw new Error('invalid regular file or file length');
        }
        if (options.canonical && realpathSync(path) !== path) {
            throw new Error('bundle file uses a noncanonical path');
        }
        if (options.executable) {
            if ((before.mode & 0o111n) === 0n) {
                throw new Error('bundle executable has no execute permission');
            }
            accessSync(path, constants.X_OK);
        }
        const bytes = readExpectedBytes(fd, size);
        const after = fstatSync(fd, { bigint: true });
        const named = lstatSync(path, { bigint: true });
        if (
            !sameFileSnapshot(before, after) ||
            !sameFileSnapshot(after, named) ||
            (options.canonical && realpathSync(path) !== path)
        ) {
            throw new Error('file changed while reading');
        }
        return bytes;
    } finally {
        closeSync(fd);
    }
}

function readBuildReceipt(path: string): BuildReceipt {
    try {
        const bytes = readStableRegularFile(path, { maxBytes: MAX_RECEIPT_BYTES });
        const receipt: unknown = JSON.parse(bytes.toString('utf8'));
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
        const app = join(realpathSync(dirname(appPath)), basename(appPath));
        if (!lstatSync(app).isDirectory()) {
            throw new Error('invalid bundle');
        }
        const binary = join(app, EXECUTABLE);
        const executable = readStableRegularFile(binary, { canonical: true, executable: true });
        const components = payloadRelativePaths('darwin').map((path) => ({
            path,
            bytes: readStableRegularFile(join(app, path), { canonical: true }),
        }));
        const sha256 = digestPayloadComponents(components);
        const executableSha256 = createHash('sha256').update(executable).digest('hex');
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

async function runBoundObservation(
    options: Options,
    env: NodeJS.ProcessEnv,
    hostSupported: boolean,
    drive: (binary: string) => Promise<void>
): Promise<BoundRecord> {
    const expected = readRunIdentity(env);
    const record: BoundRecord = {
        schemaVersion: 1,
        expected,
        build: null,
        verdict: 'not-run',
        failureCode: null,
    };
    try {
        const run = requireRun(expected, hostSupported);
        if (env.FERMENTER_CAPTURE_OUTCOME !== 'success') {
            throw new FermenterProofError('build-receipt-unavailable-or-invalid');
        }
        const { build, binary } = admitBuild(options, run);
        record.build = build;
        try {
            await drive(binary);
        } finally {
            checkAfterDrive(options, build);
        }
        return { ...record, verdict: 'proven' };
    } catch (error) {
        const failureCode =
            error instanceof FermenterProofError || error instanceof FermenterDriveError ? error.code : 'driver-failed';
        const verdict = record.build === null || failureCode === 'launch-unavailable' ? 'not-run' : 'failed';
        return { ...record, verdict, failureCode };
    }
}

export async function runProof(options: Options, env: NodeJS.ProcessEnv, ports: ProofPorts): Promise<ProofRecord> {
    const observations: FermenterObservation[] = [];
    const record = await runBoundObservation(options, env, ports.hostSupported, async (binary) => {
        await ports.drive(binary, (observation) => {
            if (observation !== FERMENTER_OBSERVATIONS[observations.length]) {
                throw new FermenterProofError('observations-incomplete');
            }
            observations.push(observation);
        });
        if (observations.length !== FERMENTER_OBSERVATIONS.length) {
            throw new FermenterProofError('observations-incomplete');
        }
    });
    return { ...record, scope: 'one-packaged-fermenter-popup', observations };
}

type FamilyRecord = BoundRecord & {
    scope: 'packaged-premium-editor-mount-and-lifecycle';
    observations: FamilyObservations;
};

export async function runEditorFamilyProof(
    options: Options,
    env: NodeJS.ProcessEnv,
    ports: { hostSupported: boolean; drive: EditorFamilyDrive }
): Promise<FamilyRecord> {
    const observations = freshFamilyObservations();
    const record = await runBoundObservation(options, env, ports.hostSupported, async (binary) => {
        await ports.drive(binary, observations);
        const failure = familyFailure(observations);
        if (failure !== null) {
            throw new FermenterProofError(failure);
        }
    });
    return { ...record, scope: 'packaged-premium-editor-mount-and-lifecycle', observations };
}

type WorkspaceRecord = BoundRecord & {
    scope: 'packaged-premium-editor-workspace';
    observations: WorkspaceObservations;
};

export async function runEditorWorkspaceProof(
    options: Options,
    env: NodeJS.ProcessEnv,
    ports: { hostSupported: boolean; drive: EditorWorkspaceDrive }
): Promise<WorkspaceRecord> {
    const observations = freshWorkspaceObservations();
    const record = await runBoundObservation(options, env, ports.hostSupported, async (binary) => {
        await ports.drive(binary, observations);
        const failure = workspaceFailure(observations);
        if (failure !== null) {
            throw new FermenterProofError(failure);
        }
    });
    return { ...record, scope: 'packaged-premium-editor-workspace', observations };
}

type AuditionRecord = BoundRecord & {
    scope: 'packaged-grand-boule-output-audition';
    observations: AuditionObservations;
};

type CrumbsRecord = BoundRecord & { scope: 'packaged-crumbs-sampler'; observations: CrumbsSamplerObservations };
export async function runCrumbsSamplerProof(
    options: Options,
    env: NodeJS.ProcessEnv,
    ports: { hostSupported: boolean; drive: (binary: string, observations: CrumbsSamplerObservations) => Promise<void> }
): Promise<CrumbsRecord> {
    const observations = freshCrumbsSamplerObservations();
    const record = await runBoundObservation(options, env, ports.hostSupported, async (binary) => {
        if (env.GITHUB_EVENT_NAME !== 'schedule' || env.GITHUB_REF !== 'refs/heads/main') {
            throw new FermenterProofError('crumbs-not-scheduled-main');
        }
        await ports.drive(binary, observations);
        const failure = crumbsSamplerFailure(observations);
        if (failure) {
            throw new FermenterProofError(failure);
        }
    });
    const result: CrumbsRecord = { ...record, scope: 'packaged-crumbs-sampler', observations };
    if (
        record.failureCode === 'capture-unavailable' ||
        record.failureCode === 'crumbs-not-scheduled-main' ||
        (record.failureCode === 'driver-failed' && observations.unavailable)
    ) {
        result.verdict = 'not-run';
    }
    return result;
}
export async function runGrandBouleAuditionProof(
    options: Options,
    env: NodeJS.ProcessEnv,
    ports: { hostSupported: boolean; drive: (binary: string, observations: AuditionObservations) => Promise<void> }
): Promise<AuditionRecord> {
    const observations = freshAuditionObservations();
    const record = await runBoundObservation(options, env, ports.hostSupported, async (binary) => {
        await ports.drive(binary, observations);
        const failure = auditionFailure(observations);
        if (failure) {
            throw new FermenterProofError(failure);
        }
    });
    const result: AuditionRecord = { ...record, scope: 'packaged-grand-boule-output-audition', observations };
    if (
        record.failureCode === 'capture-unavailable' ||
        (record.failureCode === 'driver-failed' && observations.unavailable !== null)
    ) {
        result.verdict = 'not-run';
    }
    return result;
}

/** Publish a fully written private file under its final name, without overwriting prior evidence. */
function writeFinalJson(path: string, value: object): void {
    const directory = mkdtempSync(join(dirname(path), '.fermenter-'));
    const temporary = join(directory, 'record.json');
    try {
        writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        linkSync(temporary, path);
    } finally {
        try {
            rmSync(directory, { recursive: true, force: true });
        } catch {
            // The final hard link, once published, remains valid if temp cleanup fails.
            process.stderr.write('Could not remove the Fermenter receipt staging directory.\n');
        }
    }
}

async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            capture: { type: 'boolean' },
            family: { type: 'boolean' },
            workspace: { type: 'boolean' },
            audition: { type: 'boolean' },
            crumbs: { type: 'boolean' },
            receipt: { type: 'string' },
            json: { type: 'string' },
        },
    });
    const checkout = process.cwd();
    const { capture, family, workspace, audition, crumbs, receipt, json } = values;
    const observerCount = [family, workspace, audition, crumbs].filter(Boolean).length;
    if (!receipt || observerCount > 1 || (capture && (observerCount > 0 || json !== undefined))) {
        throw new TypeError(USAGE);
    }
    const options = { checkout, app: join(checkout, APP_PATH), receipt };
    const hostSupported = process.platform === 'darwin' && process.arch === 'arm64';
    if (capture) {
        captureBuildReceipt(options, process.env, hostSupported);
        process.stdout.write('Captured the Fermenter packaged build receipt.\n');
        return 0;
    }
    if (!json) {
        throw new TypeError(USAGE);
    }
    let record: FamilyRecord | ProofRecord | WorkspaceRecord | AuditionRecord | CrumbsRecord;
    if (crumbs) {
        record = await runCrumbsSamplerProof(options, process.env, {
            hostSupported,
            async drive(binary, observations) {
                const { driveDesktopCrumbsSampler } = await import('./desktopCrumbsSamplerDrive.ts');
                await driveDesktopCrumbsSampler(binary, observations);
            },
        });
    } else if (audition) {
        record = await runGrandBouleAuditionProof(options, process.env, {
            hostSupported,
            async drive(binary, observations) {
                const { driveDesktopGrandBouleAudition } = await import('./desktopGrandBouleAuditionDrive.ts');
                await driveDesktopGrandBouleAudition(binary, observations);
            },
        });
    } else if (workspace) {
        record = await runEditorWorkspaceProof(options, process.env, {
            hostSupported,
            async drive(binary, observations) {
                const { driveDesktopEditorWorkspace } = await import('./desktopEditorWorkspaceDrive.ts');
                await driveDesktopEditorWorkspace(binary, observations);
            },
        });
    } else if (family) {
        record = await runEditorFamilyProof(options, process.env, {
            hostSupported,
            async drive(binary, observations) {
                const { driveDesktopEditorFamily } = await import('./desktopEditorFamilyDrive.ts');
                await driveDesktopEditorFamily(binary, observations);
            },
        });
    } else {
        record = await runProof(options, process.env, {
            hostSupported,
            async drive(binary, report) {
                const { driveDesktopFermenter } = await import('./desktopFermenterDrive.ts');
                await driveDesktopFermenter(binary, report);
            },
        });
    }
    writeFinalJson(json, record);
    let label = 'Fermenter';
    if (crumbs) {
        label = 'Crumbs Sampler';
    } else if (audition) {
        label = 'Grand Boule output audition';
    } else if (workspace) {
        label = 'Premium editor workspace';
    } else if (family) {
        label = 'Premium editor family';
    }
    process.stdout.write(
        `${label} packaged proof: ${record.verdict}${record.failureCode ? ` (${record.failureCode})` : ''}.\n`
    );
    if (record.verdict === 'proven') {
        return 0;
    }
    if (record.verdict === 'failed') {
        return 1;
    }
    return 2;
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
