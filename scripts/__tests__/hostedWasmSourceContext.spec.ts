import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { hostedArtifactPaths } from '../hostedWasmArtifacts';
import { wasmArtifacts } from '../wasm-artifacts';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
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

function createCheckouts() {
    const directory = mkdtempSync(join(tmpdir(), 'hosted-wasm-source-context-'));
    directories.push(directory);
    const control = join(directory, 'control');
    const source = join(directory, 'source');
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', wasmArtifacts.repoRoot, control]);
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', wasmArtifacts.repoRoot, source]);
    copyFileSync(
        join(wasmArtifacts.repoRoot, 'scripts/hostedWasmArtifacts.ts'),
        join(control, 'scripts/hostedWasmArtifacts.ts')
    );
    copyFileSync(
        join(wasmArtifacts.repoRoot, 'scripts/hostedWasmSourceContext.ts'),
        join(control, 'scripts/hostedWasmSourceContext.ts')
    );
    const workflowSha = commit(control, 'fixture control helper');
    git(source, ['rm', 'scripts/hostedWasmArtifacts.ts', 'scripts/hostedWasmZip.ts']);
    const sourceBase = commit(source, 'fixture source before hosted helper');
    return { control, source, sourceBase, workflowSha };
}

function environment(input: { source: string; sourceBase: string; workflowSha: string }) {
    const headSha = git(input.source, ['rev-parse', 'HEAD']);
    return {
        ...process.env,
        BUILD_REPOSITORY: 'owner/sourdaw',
        BUILD_PR: '12',
        BUILD_HEAD_SHA: headSha,
        BUILD_BASE_SHA: input.sourceBase,
        BUILD_WORKFLOW_REF: 'owner/sourdaw/.github/workflows/wasm-artifacts.yml@refs/pull/12/merge',
        BUILD_WORKFLOW_SHA: input.workflowSha,
        BUILD_RUN_ID: '100',
        BUILD_RUN_ATTEMPT: '1',
        GITHUB_OUTPUT: join(input.source, 'github-output'),
    };
}

function plan(
    input: { control: string; source: string; sourceBase: string; workflowSha: string },
    overrides: Record<string, string> = {}
) {
    return spawnSync(process.execPath, [join(input.control, 'scripts/hostedWasmArtifacts.ts'), 'plan', input.source], {
        encoding: 'utf8',
        env: { ...environment(input), ...overrides },
    });
}

describe('hosted WASM source context CLI', () => {
    it('executes the control helper against a distinct clean source root that lacks both hosted helpers', () => {
        const input = createCheckouts();
        expect(() => readFileSync(join(input.source, 'scripts/hostedWasmArtifacts.ts'))).toThrow();
        expect(() => readFileSync(join(input.source, 'scripts/hostedWasmZip.ts'))).toThrow();
        expect(() => readFileSync(join(input.source, 'scripts/hostedWasmSourceContext.ts'))).toThrow();

        const unchanged = plan(input);
        expect(unchanged.status, unchanged.stderr).toBe(0);
        expect(readFileSync(join(input.source, 'github-output'), 'utf8')).toContain('selected=false');

        writeFileSync(join(input.source, 'crates/scoring/src/lib.rs'), '\n// fixture source closure change\n', {
            flag: 'a',
        });
        commit(input.source, 'fixture scoring source change');
        const scoring = plan(input);
        expect(scoring.status, scoring.stderr).toBe(0);
        expect(scoring.stdout).toContain('selected: scoring');

        const output = readFileSync(join(input.source, 'github-output'), 'utf8');
        expect(output).toContain('selected=true');

        const toolchainPath = join(input.source, 'rust-toolchain.toml');
        writeFileSync(
            toolchainPath,
            readFileSync(toolchainPath, 'utf8').replace(/channel\s*=\s*"[^"]+"/, 'channel = "nightly-2099-01-01"')
        );
        commit(input.source, 'fixture source toolchain pin');
        const sharedInput = plan(input);
        expect(sharedInput.status, sharedInput.stderr).toBe(0);
        expect(sharedInput.stdout).toContain('selected: scoring, proof-chamber');
        expect(readFileSync(join(input.source, 'github-output'), 'utf8')).toContain(
            'rust-toolchain=nightly-2099-01-01'
        );

        writeFileSync(join(input.source, 'untracked-source-context-sentinel'), 'dirty\n');
        const dirty = plan(input);
        expect(dirty.status).not.toBe(0);
        expect(dirty.stderr).toContain('clean source checkout');
        rmSync(join(input.source, 'untracked-source-context-sentinel'));

        writeFileSync(join(input.source, 'scripts/wasm-artifacts.ts'), 'throw new Error("source toolkit imported");\n');
        commit(input.source, 'fixture invalid-head sentinel');
        const wrongSourceHead = plan(input, { BUILD_HEAD_SHA: '0'.repeat(40) });
        expect(wrongSourceHead.status).not.toBe(0);
        expect(wrongSourceHead.stderr).toContain('requested source head');
        expect(wrongSourceHead.stderr).not.toContain('source toolkit imported');
        const wrongControlHead = plan(input, { BUILD_WORKFLOW_SHA: '0'.repeat(40) });
        expect(wrongControlHead.status).not.toBe(0);
        expect(wrongControlHead.stderr).toContain('requested source head');
        expect(wrongControlHead.stderr).not.toContain('source toolkit imported');

        writeFileSync(join(input.source, 'scripts/wasm-artifacts.ts'), 'export const wasmArtifacts = {};\n');
        commit(input.source, 'fixture incompatible toolkit');
        const incompatible = plan(input);
        expect(incompatible.status).not.toBe(0);
        expect(incompatible.stderr).toContain('exports are incomplete');
    }, 60_000);

    it('verifies a returned archive against an explicit source root without importing its toolkit', () => {
        const input = createCheckouts();
        writeFileSync(join(input.source, 'scripts/wasm-artifacts.ts'), 'throw new Error("source toolkit imported");\n');
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
                rustc: 'rustc 1.96.0-nightly',
                rustToolchain: 'nightly-x86_64-unknown-linux-gnu',
                wasmPack: 'wasm-pack 0.13.1',
                wasmBindgen: '0.2.100',
            },
            files: Object.fromEntries(
                Object.entries(files).map(([path, bytes]) => [
                    path,
                    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
                ])
            ),
        };
        files['receipt.json'] = Buffer.from(`${JSON.stringify(receipt)}\n`);
        const zip = Buffer.from(zipSync(files));
        const archivePath = join(input.source, '..', 'returned.zip');
        const runPath = join(input.source, '..', 'run.json');
        const artifactPath = join(input.source, '..', 'artifact.json');
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
        const output = join(input.source, '..', 'verified');
        const result = spawnSync(
            process.execPath,
            [
                join(input.control, 'scripts/hostedWasmArtifacts.ts'),
                'verify-return',
                input.source,
                archivePath,
                runPath,
                artifactPath,
                'owner/sourdaw',
                '12',
                '100',
                '200',
                output,
            ],
            { encoding: 'utf8' }
        );
        expect(result.status, result.stderr).toBe(0);
        expect(existsSync(join(output, paths[0] ?? ''))).toBe(true);
    }, 60_000);
});
