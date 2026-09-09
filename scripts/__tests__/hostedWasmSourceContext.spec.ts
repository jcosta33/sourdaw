import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { hostedArtifactPaths } from '../hostedWasmArtifacts';
import { wasmArtifacts } from '../wasm-artifacts';

const directories: string[] = [];
const fixtureToolkits = ['wasm-artifacts.ts', 'wasmToolchainPins.ts', 'workspaceManifestFingerprint.ts'] as const;

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root: string, message: string): string {
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', message]);
    return git(root, ['rev-parse', 'HEAD']);
}

function writeFixtureToolkit(root: string, marker: string): void {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const file of fixtureToolkits) {
        copyFileSync(join(wasmArtifacts.repoRoot, 'scripts', file), join(root, 'scripts', file));
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', packageManager: 'pnpm@11.6.0' }));
    writeFileSync(join(root, 'rust-toolchain.toml'), `[toolchain]\nchannel = "nightly-fixture-${marker}"\n`);
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nresolver = "2"\n');
    const packageNames = wasmArtifacts.packages.map((spec) => spec.id);
    writeFileSync(
        join(root, 'Cargo.lock'),
        [
            'version = 4',
            ...packageNames.map((name) => `[[package]]\nname = "${name}"\nversion = "0.1.0"\n`),
            '[[package]]\nname = "wasm-bindgen"\nversion = "0.2.100"\n',
        ].join('\n')
    );
    for (const spec of wasmArtifacts.packages) {
        const crate = join(root, spec.crateDir);
        mkdirSync(join(crate, 'src'), { recursive: true });
        writeFileSync(join(crate, 'Cargo.toml'), `[package]\nname = "${spec.id}"\nversion = "0.1.0"\n`);
        writeFileSync(
            join(crate, 'src', 'lib.rs'),
            `pub fn fixture_${spec.id.replaceAll('-', '_')}() { /* ${marker} */ }\n`
        );
    }
}

function writeFixtureManifest(root: string): void {
    const script = join(root, 'scripts', 'writeFixtureManifest.ts');
    writeFileSync(
        script,
        String.raw`import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { wasmArtifacts } from './wasm-artifacts.ts';

const root = join(import.meta.dirname, '..');
const packages = Object.fromEntries(
    wasmArtifacts.packages.map((spec) => [
        spec.id,
        {
            crate: spec.crateDir,
            crateSourceHash: wasmArtifacts.hashCrateClosure(spec.crateDir),
            schemaHash: 'fixture',
            artifacts: {},
        },
    ])
);
const manifest = {
    comment: 'fixture',
    toolchain: {
        wasmPack: wasmArtifacts.pinnedToolchain.wasmPack,
        wasmBindgen: wasmArtifacts.wasmBindgenLockVersion(),
        rustToolchain: wasmArtifacts.rustToolchainChannel(),
        wasmOpt: wasmArtifacts.pinnedToolchain.wasmOpt,
    },
    packages,
};
mkdirSync(join(root, 'public', 'wasm'), { recursive: true });
writeFileSync(join(root, 'public', 'wasm', 'manifest.json'), JSON.stringify(manifest) + '\n');
`
    );
    execFileSync(process.execPath, [script]);
    rmSync(script);
}

async function createCheckouts(): Promise<{
    control: string;
    source: string;
    sourceBase: string;
    workflowSha: string;
}> {
    const directory = mkdtempSync(join(tmpdir(), 'hosted-wasm-source-context-'));
    directories.push(directory);
    const control = join(directory, 'control');
    const source = join(directory, 'source');
    mkdirSync(control);
    mkdirSync(source);
    writeFixtureToolkit(control, 'control');
    writeFixtureToolkit(source, 'source');
    writeFixtureManifest(control);
    writeFixtureManifest(source);
    for (const file of ['hostedWasmArtifacts.ts', 'hostedWasmSourceContext.ts', 'hostedWasmZip.ts'] as const) {
        copyFileSync(join(wasmArtifacts.repoRoot, 'scripts', file), join(control, 'scripts', file));
    }
    mkdirSync(join(control, 'node_modules'));
    execFileSync('cp', ['-R', join(wasmArtifacts.repoRoot, 'node_modules', 'fflate'), join(control, 'node_modules')]);
    git(control, ['init', '--quiet']);
    const workflowSha = commit(control, 'fixture workflow control');
    git(source, ['init', '--quiet']);
    mkdirSync(join(source, 'verified'));
    writeFileSync(join(source, 'verified', '.gitkeep'), 'fixture return subdirectory\n');
    const sourceBase = commit(source, 'fixture source baseline');
    return { control, source, sourceBase, workflowSha };
}

function environment(input: { source: string; sourceBase: string; workflowSha: string }) {
    return {
        ...process.env,
        BUILD_REPOSITORY: 'owner/sourdaw',
        BUILD_PR: '12',
        BUILD_HEAD_SHA: git(input.source, ['rev-parse', 'HEAD']),
        BUILD_BASE_SHA: input.sourceBase,
        BUILD_WORKFLOW_REF: 'owner/sourdaw/.github/workflows/wasm-artifacts.yml@refs/pull/12/merge',
        BUILD_WORKFLOW_SHA: input.workflowSha,
        BUILD_RUN_ID: '100',
        BUILD_RUN_ATTEMPT: '1',
        GITHUB_OUTPUT: join(dirname(input.source), 'github-output'),
    };
}

function plan(
    input: { control: string; source: string; sourceBase: string; workflowSha: string },
    sourceRoot: string = input.source,
    overrides: Record<string, string> = {}
) {
    return spawnSync(process.execPath, [join(input.control, 'scripts/hostedWasmArtifacts.ts'), 'plan', sourceRoot], {
        encoding: 'utf8',
        env: { ...environment(input), ...overrides },
    });
}

describe('hosted WASM source context CLI', () => {
    it('uses a clean source toolkit with no hosted helpers and selects source-only closure and pin changes', async () => {
        const input = await createCheckouts();
        expect(readdirSync(join(input.source, 'scripts')).sort()).toEqual([...fixtureToolkits].sort());
        for (const helper of ['hostedWasmArtifacts.ts', 'hostedWasmSourceContext.ts', 'hostedWasmZip.ts']) {
            expect(existsSync(join(input.source, 'scripts', helper))).toBe(false);
        }
        expect(input.sourceBase).not.toBe(input.workflowSha);
        const baseline = plan(input);
        expect(baseline.status, baseline.stderr).toBe(0);
        expect(readFileSync(join(dirname(input.source), 'github-output'), 'utf8')).toContain('selected=false');

        writeFileSync(join(input.source, 'README.md'), 'irrelevant source change\n');
        commit(input.source, 'fixture irrelevant source change');
        const irrelevant = plan(input);
        expect(irrelevant.status, irrelevant.stderr).toBe(0);
        expect(irrelevant.stdout).toContain('selected: none');

        writeFileSync(join(input.source, 'crates/scoring/src/lib.rs'), '\n// source-only closure change\n', {
            flag: 'a',
        });
        commit(input.source, 'fixture scoring closure');
        const scoring = plan(input);
        expect(scoring.status, scoring.stderr).toBe(0);
        expect(scoring.stdout).toContain('selected: scoring');

        const toolchainPath = join(input.source, 'rust-toolchain.toml');
        writeFileSync(toolchainPath, '[toolchain]\nchannel = "nightly-fixture-divergent"\n');
        commit(input.source, 'fixture source pin');
        const shared = plan(input);
        expect(shared.status, shared.stderr).toBe(0);
        expect(shared.stdout).toContain('selected: scoring, proof-chamber');
        expect(readFileSync(join(dirname(input.source), 'github-output'), 'utf8')).toContain(
            'rust-toolchain=nightly-fixture-divergent'
        );
    }, 60_000);

    it('selects source-context shared input and a narrow generator from actual source hashes', async () => {
        const shared = await createCheckouts();
        writeFileSync(join(shared.source, 'scripts', 'hostedWasmSourceContext.ts'), 'control-only helper changed\n');
        commit(shared.source, 'fixture shared context input');
        const sharedPlan = plan(shared);
        expect(sharedPlan.status, sharedPlan.stderr).toBe(0);
        expect(sharedPlan.stdout).toContain('selected: scoring, proof-chamber');

        const narrow = await createCheckouts();
        writeFileSync(join(narrow.source, 'scripts', 'gen-scoring-worklet.ts'), 'generator changed\n');
        commit(narrow.source, 'fixture scoring generator');
        const narrowPlan = plan(narrow);
        expect(narrowPlan.status, narrowPlan.stderr).toBe(0);
        expect(narrowPlan.stdout).toContain('selected: scoring');
    }, 60_000);

    it('refuses dirty, invalid-head, non-top-level, same, nested, and incompatible source roots before import', async () => {
        const input = await createCheckouts();
        writeFileSync(join(input.source, 'sentinel'), 'dirty\n');
        expect(plan(input).stderr).toContain('clean source checkout');
        rmSync(join(input.source, 'sentinel'));

        writeFileSync(
            join(input.source, 'scripts', 'wasm-artifacts.ts'),
            'throw new Error("source toolkit imported");\n'
        );
        commit(input.source, 'fixture source sentinel');
        const wrongSourceHead = plan(input, input.source, { BUILD_HEAD_SHA: '0'.repeat(40) });
        expect(wrongSourceHead.stderr).toContain('requested source head');
        expect(wrongSourceHead.stderr).not.toContain('source toolkit imported');
        const wrongControlHead = plan(input, input.source, { BUILD_WORKFLOW_SHA: '0'.repeat(40) });
        expect(wrongControlHead.stderr).toContain('requested source head');
        expect(wrongControlHead.stderr).not.toContain('source toolkit imported');
        expect(plan(input, join(input.source, 'scripts')).stderr).toContain('not a Git top-level');
        expect(plan(input, input.control).stderr).toContain('distinct siblings');

        const nested = join(input.source, 'nested');
        mkdirSync(nested);
        git(nested, ['init', '--quiet']);
        writeFileSync(join(nested, 'fixture'), 'nested\n');
        commit(nested, 'nested');
        expect(plan(input, nested).stderr).toContain('distinct siblings');
        rmSync(nested, { recursive: true });

        const unsupported = await createCheckouts();
        writeFileSync(
            join(unsupported.source, 'crates/daw-wasm-decoder/src/lib.rs'),
            '\n// unsupported stale closure\n',
            {
                flag: 'a',
            }
        );
        commit(unsupported.source, 'fixture unsupported stale closure');
        expect(plan(unsupported).stderr).toContain('Unsupported stale WASM package: daw-wasm-decoder');

        const incompatible = await createCheckouts();
        writeFileSync(
            join(incompatible.source, 'scripts', 'wasm-artifacts.ts'),
            '\nwasmArtifacts.packages[0]!.artifacts.push("unexpected-artifact");\n',
            { flag: 'a' }
        );
        commit(incompatible.source, 'fixture incompatible descriptor');
        expect(plan(incompatible).stderr).toContain('package registry is incompatible');

        writeFileSync(join(input.source, 'scripts', 'wasm-artifacts.ts'), 'export const wasmArtifacts = {};\n');
        commit(input.source, 'fixture incomplete toolkit');
        expect(plan(input).stderr).toContain('exports are incomplete');
    }, 60_000);

    it('verifies a returned archive only from an explicit source Git root and never imports source code', async () => {
        const input = await createCheckouts();
        writeFileSync(
            join(input.source, 'scripts', 'wasm-artifacts.ts'),
            'throw new Error("source toolkit imported");\n'
        );
        const sourceHead = commit(input.source, 'fixture hostile return toolkit');
        const paths = hostedArtifactPaths(['scoring']);
        const files = Object.fromEntries(paths.map((path) => [path, Buffer.from(`fixture ${path}`)]));
        const receipt = {
            version: 1,
            repository: 'owner/sourdaw',
            pullRequest: 12,
            headSha: sourceHead,
            baseSha: input.sourceBase,
            workflowRef: 'owner/sourdaw/.github/workflows/wasm-artifacts.yml@refs/pull/12/merge',
            workflowSha: input.workflowSha,
            runId: '100',
            runAttempt: 1,
            packages: ['scoring'],
            toolchain: {
                node: 'v24.19.0',
                pnpm: '11.6.0',
                rustc: 'rustc fixture',
                rustToolchain: 'fixture',
                wasmPack: 'fixture',
                wasmBindgen: 'fixture',
            },
            files: Object.fromEntries(
                Object.entries(files).map(([path, bytes]) => [
                    path,
                    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
                ])
            ),
        };
        files['receipt.json'] = Buffer.from(`${JSON.stringify(receipt)}\n`);
        const root = dirname(input.source);
        const archivePath = join(root, 'returned.zip');
        const runPath = join(root, 'run.json');
        const artifactPath = join(root, 'artifact.json');
        const output = join(root, 'verified');
        const zip = Buffer.from(zipSync(files));
        writeFileSync(archivePath, zip);
        writeFileSync(
            runPath,
            JSON.stringify({
                id: 100,
                run_attempt: 1,
                head_sha: sourceHead,
                event: 'pull_request',
                path: '.github/workflows/wasm-artifacts.yml',
                status: 'completed',
                conclusion: 'success',
                repository: { id: 50, full_name: 'owner/sourdaw' },
                head_repository: { id: 50, full_name: 'owner/sourdaw' },
                pull_requests: [{ number: 12, head: { sha: sourceHead } }],
            })
        );
        writeFileSync(
            artifactPath,
            JSON.stringify({
                id: 200,
                name: `wasm-${sourceHead}-100-1`,
                expired: false,
                size_in_bytes: zip.length,
                digest: `sha256:${createHash('sha256').update(zip).digest('hex')}`,
                workflow_run: { id: 100, repository_id: 50, head_repository_id: 50, head_sha: sourceHead },
            })
        );
        const invoke = (sourceRoot: string, destination: string) =>
            spawnSync(
                process.execPath,
                [
                    join(input.control, 'scripts/hostedWasmArtifacts.ts'),
                    'verify-return',
                    sourceRoot,
                    archivePath,
                    runPath,
                    artifactPath,
                    'owner/sourdaw',
                    '12',
                    '100',
                    '200',
                    destination,
                ],
                { encoding: 'utf8' }
            );
        const subdirectoryOutput = join(root, 'subdirectory-output');
        const subdirectory = invoke(join(input.source, 'verified'), subdirectoryOutput);
        expect(subdirectory.status).not.toBe(0);
        expect(subdirectory.stderr).toContain('not a Git top-level');
        expect(existsSync(subdirectoryOutput)).toBe(false);
        const verified = invoke(input.source, output);
        expect(verified.status, verified.stderr).toBe(0);
        expect(existsSync(join(output, paths[0] ?? ''))).toBe(true);
    }, 60_000);
});
