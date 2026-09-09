import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    appendFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertCanonicalArtifactPath, hostedWasmOutputLimit, readHostedArtifactZip } from './hostedWasmZip.ts';
import { wasmArtifacts, type WasmManifest } from './wasm-artifacts.ts';

const supportedIds = ['scoring', 'proof-chamber'] as const;
const manifestPath = 'public/wasm/manifest.json';
const outputLimit = hostedWasmOutputLimit;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const sharedInputs = new Set([
    '.cargo/config.toml',
    '.github/workflows/wasm-artifacts.yml',
    'scripts/hostedWasmArtifacts.ts',
    'scripts/hostedWasmZip.ts',
    'scripts/wasm-artifacts.ts',
    'scripts/wasmToolchainPins.ts',
    'scripts/workspaceManifestFingerprint.ts',
    'scripts/markWasmPackageInternal.ts',
    'scripts/gen-wasm-manifest.ts',
    'scripts/verify-wasm-artifacts.ts',
    'scripts/strictJson.ts',
    'scripts/workletPolyfills.ts',
    'rust-toolchain.toml',
    'package.json',
    'pnpm-lock.yaml',
]);
const generators: Record<string, string> = {
    scoring: 'scripts/gen-scoring-worklet.ts',
    'proof-chamber': 'scripts/gen-proof-chamber-worklet.ts',
};

type Command = (command: string, args: string[]) => void;
type Capture = (command: string, args: string[]) => string;
type BuildIdentity = {
    repository: string;
    pullRequest: number;
    headSha: string;
    baseSha: string;
    workflowRef: string;
    workflowSha: string;
    runId: string;
    runAttempt: number;
};
type Toolchain = {
    node: string;
    pnpm: string;
    rustc: string;
    rustToolchain: string;
    wasmPack: string;
    wasmBindgen: string;
};
type BuildReceipt = BuildIdentity & {
    version: 1;
    packages: string[];
    toolchain: Toolchain;
    files: Record<string, string>;
};

function packageSpec(id: string) {
    if (!supportedIds.some((supported) => supported === id)) {
        throw new Error(`Unsupported hosted WASM package: ${id}`);
    }
    const spec = wasmArtifacts.packages.find((candidate) => candidate.id === id);
    if (!spec) {
        throw new Error(`Missing WASM package authority: ${id}`);
    }
    return spec;
}

export function selectHostedWasmPackages(input: {
    manifest: WasmManifest;
    sourceHashes: Record<string, string>;
    changedPaths: string[];
}): string[] {
    const sharedChange = input.changedPaths.some((path) => sharedInputs.has(path));
    const selected: string[] = [];
    for (const spec of wasmArtifacts.packages) {
        const recorded = input.manifest.packages[spec.id];
        const live = input.sourceHashes[spec.id];
        if (
            !recorded ||
            recorded.crate !== spec.crateDir ||
            !hashPattern.test(recorded.crateSourceHash) ||
            !live ||
            !hashPattern.test(live)
        ) {
            throw new Error(`Invalid WASM source provenance for ${spec.id}`);
        }
        if (!supportedIds.some((id) => id === spec.id) && live !== recorded.crateSourceHash) {
            throw new Error(`Unsupported stale WASM package: ${spec.id}; this workflow cannot rebuild it`);
        }
    }
    for (const id of supportedIds) {
        const spec = packageSpec(id);
        const recorded = input.manifest.packages[id];
        const live = input.sourceHashes[id];
        if (
            !recorded ||
            recorded.crate !== spec.crateDir ||
            !hashPattern.test(recorded.crateSourceHash) ||
            !live ||
            !hashPattern.test(live)
        ) {
            throw new Error(`Invalid WASM source provenance for ${id}`);
        }
        if (sharedChange || input.changedPaths.includes(generators[id]!) || live !== recorded.crateSourceHash) {
            selected.push(id);
        }
    }
    return selected;
}

function required(env: NodeJS.ProcessEnv, key: string, pattern: RegExp): string {
    const value = env[key];
    if (!value || !pattern.test(value)) {
        throw new Error(`Invalid or missing ${key}`);
    }
    return value;
}

export function readHostedBuildIdentity(env: NodeJS.ProcessEnv): BuildIdentity {
    const repository = required(env, 'BUILD_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    const workflowRef = required(env, 'BUILD_WORKFLOW_REF', /^[^\s]+$/);
    if (!workflowRef.startsWith(`${repository}/.github/workflows/wasm-artifacts.yml@`)) {
        throw new Error('Unexpected hosted WASM workflow reference');
    }
    return {
        repository,
        pullRequest: Number(required(env, 'BUILD_PR', /^[1-9][0-9]{0,9}$/)),
        headSha: required(env, 'BUILD_HEAD_SHA', shaPattern),
        baseSha: required(env, 'BUILD_BASE_SHA', shaPattern),
        workflowRef,
        workflowSha: required(env, 'BUILD_WORKFLOW_SHA', shaPattern),
        runId: required(env, 'BUILD_RUN_ID', /^[1-9][0-9]{0,19}$/),
        runAttempt: Number(required(env, 'BUILD_RUN_ATTEMPT', /^[1-9][0-9]{0,5}$/)),
    };
}

function captureAt(root: string): Capture {
    return (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trimEnd();
}

function runAt(root: string): Command {
    return (command, args) => {
        console.log(`Running ${command} ${args.join(' ')}`);
        execFileSync(command, args, { cwd: root, stdio: 'inherit' });
    };
}

function assertHead(capture: Capture, expected: string): void {
    if (capture('git', ['rev-parse', 'HEAD']) !== expected) {
        throw new Error('Checkout does not match the requested source head');
    }
}

function changedWorktreePaths(capture: Capture): string[] {
    return [
        capture('git', ['diff', '--name-only', '-z', 'HEAD']),
        capture('git', ['ls-files', '--others', '--exclude-standard', '-z']),
    ].flatMap((output) => output.split('\0').filter(Boolean));
}

export function planHostedWasmBuild(
    identity: BuildIdentity,
    capture: Capture = captureAt(wasmArtifacts.repoRoot)
): string[] {
    assertHead(capture, identity.headSha);
    if (changedWorktreePaths(capture).length > 0) {
        throw new Error('Hosted build requires a clean source checkout');
    }
    const mergeBase = capture('git', ['merge-base', identity.baseSha, identity.headSha]);
    if (!shaPattern.test(mergeBase)) {
        throw new Error('Cannot resolve the PR merge base');
    }
    const changedPaths = capture('git', ['diff', '--name-only', '-z', mergeBase, identity.headSha])
        .split('\0')
        .filter(Boolean);
    const manifest = wasmArtifacts.readManifest();
    const sourceHashes = Object.fromEntries(
        wasmArtifacts.packages.map((spec) => [spec.id, wasmArtifacts.hashCrateClosure(spec.crateDir)])
    );
    return selectHostedWasmPackages({ manifest, sourceHashes, changedPaths });
}

export function hostedArtifactPaths(selected: readonly string[]): string[] {
    if (new Set(selected).size !== selected.length) {
        throw new Error('Duplicate selected package');
    }
    const paths = [...selected.flatMap((id) => packageSpec(id).artifacts), manifestPath];
    for (const path of paths) {
        assertCanonicalArtifactPath(path);
    }
    if (new Set(paths).size !== paths.length) {
        throw new Error('Overlapping artifact paths');
    }
    return paths.sort();
}

function readRegularFile(root: string, path: string): Buffer {
    assertCanonicalArtifactPath(path);
    let current = root;
    const parts = path.split('/');
    for (const [index, part] of parts.entries()) {
        current = join(current, part);
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
            throw new Error(`Artifact is not a regular file under real directories: ${path}`);
        }
        if (index === parts.length - 1 && stat.size > outputLimit) {
            throw new Error('Hosted WASM output exceeds 10 MiB');
        }
    }
    return readFileSync(current);
}

function digest(bytes: Uint8Array): string {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function collectHostedArtifacts(root: string, selected: readonly string[]): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    let size = 0;
    for (const path of hostedArtifactPaths(selected)) {
        const bytes = readRegularFile(root, path);
        size += bytes.length;
        if (size > outputLimit) {
            throw new Error('Hosted WASM output exceeds 10 MiB');
        }
        files.set(path, bytes);
    }
    return files;
}

function readToolchain(root: string, capture: Capture): Toolchain {
    const wasmPack = capture('wasm-pack', ['--version']);
    const rustToolchain = capture('rustup', ['show', 'active-toolchain']);
    const expectedRust = wasmArtifacts.rustToolchainChannel();
    if (
        wasmPack !== `wasm-pack ${wasmArtifacts.pinnedToolchain.wasmPack}` ||
        !rustToolchain.startsWith(`${expectedRust}-`)
    ) {
        throw new Error('Installed WASM generation toolchain differs from repository pins');
    }
    const packageJson: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const pnpm = capture('pnpm', ['--version']);
    if (
        typeof packageJson !== 'object' ||
        packageJson === null ||
        Reflect.get(packageJson, 'packageManager') !== `pnpm@${pnpm}`
    ) {
        throw new Error('Installed pnpm differs from repository pin');
    }
    return {
        node: capture('node', ['--version']),
        pnpm,
        rustc: capture('rustc', ['--version']),
        rustToolchain,
        wasmPack,
        wasmBindgen: wasmArtifacts.wasmBindgenLockVersion(),
    };
}

function publishFiles(outputDirectory: string, files: Map<string, Buffer>, receipt: BuildReceipt): void {
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const size = [...files.values()].reduce((total, bytes) => total + bytes.length, receiptBytes.length);
    if (size > outputLimit || existsSync(outputDirectory)) {
        throw new Error('Output exceeds 10 MiB or destination already exists');
    }
    mkdirSync(dirname(outputDirectory), { recursive: true });
    const temporary = mkdtempSync(`${outputDirectory}.partial-`);
    try {
        for (const [path, bytes] of files) {
            const destination = join(temporary, path);
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, bytes, { flag: 'wx' });
        }
        writeFileSync(join(temporary, 'receipt.json'), receiptBytes, { flag: 'wx' });
        renameSync(temporary, outputDirectory);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

function assertPrivateOutput(root: string, outputDirectory: string): void {
    const parent = realpathSync(dirname(resolve(outputDirectory)));
    const outputRelative = relative(realpathSync(root), join(parent, 'output'));
    if (!outputRelative.startsWith('../')) {
        throw new Error('Verified output must be outside the source checkout');
    }
}

export function buildHostedWasmArtifacts(input: {
    root: string;
    outputDirectory: string;
    selected: string[];
    identity: BuildIdentity;
    run?: Command;
    capture?: Capture;
}): BuildReceipt | undefined {
    if (input.selected.length === 0) {
        return undefined;
    }
    const allowed = hostedArtifactPaths(input.selected);
    const run = input.run ?? runAt(input.root);
    const capture = input.capture ?? captureAt(input.root);
    assertHead(capture, input.identity.headSha);
    if (changedWorktreePaths(capture).length > 0) {
        throw new Error('Hosted build requires a clean source checkout');
    }
    assertPrivateOutput(input.root, input.outputDirectory);
    const toolchain = readToolchain(input.root, capture);
    console.log(`Building source ${input.identity.headSha}: ${input.selected.join(', ')}`);
    for (const id of input.selected) {
        run('pnpm', [packageSpec(id).buildScript]);
    }
    run('pnpm', ['wasm:manifest', ...input.selected.flatMap((id) => ['--package', id])]);
    run('pnpm', ['wasm:verify']);
    assertHead(capture, input.identity.headSha);
    const unexpected = changedWorktreePaths(capture).filter((path) => !allowed.includes(path));
    if (unexpected.length > 0) {
        throw new Error(`WASM generation changed source or undeclared files: ${unexpected.join(', ')}`);
    }
    const files = collectHostedArtifacts(input.root, input.selected);
    const receipt: BuildReceipt = {
        version: 1,
        ...input.identity,
        packages: [...input.selected],
        toolchain,
        files: Object.fromEntries([...files].map(([path, bytes]) => [path, digest(bytes)])),
    };
    publishFiles(input.outputDirectory, files, receipt);
    console.log(`Qualified ${files.size} files for upload; receipt source ${receipt.headSha}`);
    return receipt;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Invalid ${label}`);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
        result[key] = Reflect.get(value, key);
    }
    return result;
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new TypeError(`Invalid ${label}`);
    }
    return value;
}

function positiveInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}

function parseReceipt(value: unknown): BuildReceipt {
    const record = object(value, 'receipt');
    if (record.version !== 1 || !Array.isArray(record.packages) || record.packages.length === 0) {
        throw new Error('Invalid receipt version or packages');
    }
    const packages = record.packages.map((id) => string(id, 'package'));
    hostedArtifactPaths(packages);
    const toolchain = object(record.toolchain, 'toolchain');
    const files = object(record.files, 'file hashes');
    const identity = readHostedBuildIdentity({
        BUILD_REPOSITORY: string(record.repository, 'repository'),
        BUILD_PR: String(positiveInteger(record.pullRequest, 'PR')),
        BUILD_HEAD_SHA: string(record.headSha, 'head'),
        BUILD_BASE_SHA: string(record.baseSha, 'base'),
        BUILD_WORKFLOW_REF: string(record.workflowRef, 'workflow ref'),
        BUILD_WORKFLOW_SHA: string(record.workflowSha, 'workflow SHA'),
        BUILD_RUN_ID: string(record.runId, 'run ID'),
        BUILD_RUN_ATTEMPT: String(positiveInteger(record.runAttempt, 'attempt')),
    });
    return {
        version: 1,
        ...identity,
        packages,
        toolchain: {
            node: string(toolchain.node, 'node'),
            pnpm: string(toolchain.pnpm, 'pnpm'),
            rustc: string(toolchain.rustc, 'rustc'),
            rustToolchain: string(toolchain.rustToolchain, 'rust toolchain'),
            wasmPack: string(toolchain.wasmPack, 'wasm-pack'),
            wasmBindgen: string(toolchain.wasmBindgen, 'wasm-bindgen'),
        },
        files: Object.fromEntries(Object.entries(files).map(([path, hash]) => [path, string(hash, 'file hash')])),
    };
}

type ReturnInput = {
    zip: Buffer;
    run: unknown;
    artifact: unknown;
    repository: string;
    pullRequest: number;
    runId: string;
    artifactId: string;
    root: string;
    outputDirectory: string;
    capture?: Capture;
};

function validateApiArtifact(
    input: ReturnInput,
    run: Record<string, unknown>,
    artifact: Record<string, unknown>
): string {
    const runRepository = object(run.repository, 'run repository');
    const headRepository = object(run.head_repository, 'run head repository');
    const artifactRun = object(artifact.workflow_run, 'artifact run');
    if (
        !/^[1-9][0-9]*$/.test(input.runId) ||
        !/^[1-9][0-9]*$/.test(input.artifactId) ||
        String(positiveInteger(run.id, 'run ID')) !== input.runId ||
        String(positiveInteger(artifact.id, 'artifact ID')) !== input.artifactId ||
        String(artifactRun.id) !== input.runId ||
        runRepository.full_name !== input.repository ||
        artifactRun.repository_id !== runRepository.id ||
        artifactRun.head_repository_id !== headRepository.id ||
        artifact.expired !== false ||
        artifact.size_in_bytes !== input.zip.length ||
        artifact.digest !== digest(input.zip)
    ) {
        throw new Error('GitHub run/artifact identity, success, size, or digest mismatch');
    }
    const expectedHead = string(run.head_sha, 'API head');
    if (!shaPattern.test(expectedHead) || artifactRun.head_sha !== expectedHead) {
        throw new Error('GitHub source head mismatch');
    }
    return expectedHead;
}

function validateReceiptIdentity(
    input: ReturnInput,
    run: Record<string, unknown>,
    artifact: Record<string, unknown>,
    receipt: BuildReceipt,
    expectedHead: string
): void {
    const pullRequests = run.pull_requests;
    const matchesPr =
        Array.isArray(pullRequests) &&
        pullRequests.some((value: unknown) => {
            const pr = object(value, 'API PR');
            return pr.number === input.pullRequest && object(pr.head, 'PR head').sha === expectedHead;
        });
    if (
        !matchesPr ||
        receipt.repository !== input.repository ||
        receipt.pullRequest !== input.pullRequest ||
        receipt.headSha !== expectedHead ||
        receipt.runId !== input.runId ||
        receipt.runAttempt !== run.run_attempt ||
        artifact.name !== `wasm-${expectedHead}-${input.runId}-${receipt.runAttempt}`
    ) {
        throw new Error('Receipt differs from the requested GitHub PR/run/attempt');
    }
}

export function verifyHostedWasmReturn(input: ReturnInput): BuildReceipt {
    const run = object(input.run, 'API run');
    const artifact = object(input.artifact, 'API artifact');
    if (
        run.event !== 'pull_request' ||
        run.path !== '.github/workflows/wasm-artifacts.yml' ||
        run.status !== 'completed' ||
        run.conclusion !== 'success'
    ) {
        throw new Error('GitHub run must be a successful hosted WASM pull request build');
    }
    const expectedHead = validateApiArtifact(input, run, artifact);
    const capture = input.capture ?? captureAt(input.root);
    assertHead(capture, expectedHead);
    if (changedWorktreePaths(capture).length > 0) {
        throw new Error('Artifact return requires an unchanged clean source checkout');
    }
    const files = readHostedArtifactZip(input.zip, hostedArtifactPaths([...supportedIds]).length + 1);
    const receiptBytes = files.get('receipt.json');
    if (!receiptBytes) {
        throw new Error('Artifact receipt is missing');
    }
    const receipt = parseReceipt(JSON.parse(receiptBytes.toString('utf8')));
    validateReceiptIdentity(input, run, artifact, receipt, expectedHead);
    files.delete('receipt.json');
    const expected = hostedArtifactPaths(receipt.packages);
    if (files.size !== expected.length || Object.keys(receipt.files).length !== expected.length) {
        throw new Error('Incomplete or extra artifact files');
    }
    for (const path of expected) {
        const bytes = files.get(path);
        if (!bytes || receipt.files[path] !== digest(bytes)) {
            throw new Error(`Missing artifact or wrong hash: ${path}`);
        }
    }
    assertPrivateOutput(input.root, input.outputDirectory);
    publishFiles(input.outputDirectory, files, receipt);
    return receipt;
}

function main(): void {
    if (process.argv[2] === 'verify-return') {
        const [zipPath, runPath, artifactPath, repository, pr, runId, artifactId, outputDirectory] =
            process.argv.slice(3);
        if (
            !zipPath ||
            !runPath ||
            !artifactPath ||
            !repository ||
            !pr ||
            !runId ||
            !artifactId ||
            !outputDirectory ||
            process.argv.length !== 11 ||
            !/^[1-9][0-9]*$/.test(pr)
        ) {
            throw new Error(
                'Usage: node scripts/hostedWasmArtifacts.ts verify-return <zip> <run.json> <artifact.json> <owner/repo> <PR> <run ID> <artifact ID> <private-output-directory>'
            );
        }
        if (lstatSync(zipPath).size > outputLimit) {
            throw new Error('ZIP exceeds 10 MiB');
        }
        const receipt = verifyHostedWasmReturn({
            zip: readFileSync(zipPath),
            run: JSON.parse(readFileSync(runPath, 'utf8')),
            artifact: JSON.parse(readFileSync(artifactPath, 'utf8')),
            repository,
            pullRequest: Number(pr),
            runId,
            artifactId,
            root: wasmArtifacts.repoRoot,
            outputDirectory,
        });
        console.log(
            `Verified run ${receipt.runId} attempt ${receipt.runAttempt}, source ${receipt.headSha}; private files: ${outputDirectory}`
        );
        return;
    }
    const identity = readHostedBuildIdentity(process.env);
    const selected = planHostedWasmBuild(identity);
    const mode = process.argv[2];
    if (mode === 'plan') {
        console.log(`Source ${identity.headSha}; selected: ${selected.join(', ') || 'none (no build or upload)'}`);
        const output = process.env.GITHUB_OUTPUT;
        if (!output) {
            throw new Error('Missing GitHub step output path');
        }
        appendFileSync(
            output,
            `selected=${selected.length > 0}\nwasm-pack=${wasmArtifacts.pinnedToolchain.wasmPack}\nrust-toolchain=${wasmArtifacts.rustToolchainChannel()}\n`
        );
        return;
    }
    if (mode !== 'build' || !process.env.BUILD_OUTPUT_DIRECTORY) {
        throw new Error('Usage: hostedWasmArtifacts.ts plan|build with hosted build environment');
    }
    buildHostedWasmArtifacts({
        root: wasmArtifacts.repoRoot,
        outputDirectory: process.env.BUILD_OUTPUT_DIRECTORY,
        selected,
        identity,
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
