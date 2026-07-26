import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createEvidencePolicy } from '../evidenceContract';
import { createGitCheckout, runEvidenceGate, type EvidenceRunnerDependencies } from '../run-evidence-gate';

const head = 'a'.repeat(40);
const roots: string[] = [];
const manifest = 'evidence/agent-campaign/manifest.json';
const gate = ['--task', 'TASK-SA-00-protocol-governance', '--gate', 'AC-060', '--manifest', manifest];

async function setup(overrides: Partial<EvidenceRunnerDependencies> = {}) {
    const root = await mkdtemp(join(tmpdir(), 'sourdaw-evidence-runner-'));
    const policy = createEvidencePolicy();
    roots.push(root);
    await mkdir(join(root, 'evidence/agent-campaign'), { recursive: true });
    await writeFile(join(root, manifest), `${JSON.stringify(policy)}\n`, { flag: 'wx' });
    return {
        root,
        fileSystem: {
            readText: (path: string) => readFile(path, 'utf8'),
            realPath: (path: string) => realpath(path),
        },
        checkout: {
            root: () => Promise.resolve(root),
            head: () => Promise.resolve(head),
            baselineIsAncestor: () => Promise.resolve(true),
            dirty: () => Promise.resolve(false),
        },
        ...overrides,
    };
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runEvidenceGate', () => {
    it('should execute through a symlink and tolerate import without an argv entrypoint', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-evidence-runner-cli-'));
        const repositoryRoot = process.cwd();
        const script = join(repositoryRoot, 'scripts/agent-campaign/run-evidence-gate.ts');
        const link = join(root, 'runner.ts');
        roots.push(root);
        await symlink(script, link);

        const invocation = spawnSync(process.execPath, ['--experimental-strip-types', link, ...gate], {
            cwd: repositoryRoot,
            encoding: 'utf8',
        });
        const output: unknown = JSON.parse(invocation.stdout);
        expect(invocation.status).not.toBe(0);
        expect(invocation.stdout).toBe(`${JSON.stringify(output)}\n`);
        expect(output).toMatchObject({ ok: false, exitCode: invocation.status });

        const importOnly = spawnSync(
            process.execPath,
            [
                '--experimental-strip-types',
                '--input-type=module',
                '--eval',
                `process.argv.splice(1); await import(${JSON.stringify(pathToFileURL(script).href)})`,
            ],
            { cwd: repositoryRoot, encoding: 'utf8' }
        );
        expect([importOnly.status, importOnly.stdout]).toEqual([0, '']);
    });

    it.each([
        ['--release'],
        ['--gate', 'AC-060', '--manifest', manifest],
        ['--release', '--suite', 'webllm-real', '--manifest', manifest],
        ['--suite', 'webllm-real', '--suite', 'browser-ui', '--manifest', manifest],
        ['--wat', 'value', '--manifest', manifest],
    ])('should reject invalid arguments %#', async (...arguments_) => {
        expect(await runEvidenceGate(arguments_, await setup())).toMatchObject({
            ok: false,
            exitCode: 2,
            code: 'invalid-arguments',
        });
    });

    it('should bind observed identity while every executable mode fails closed', async () => {
        const dependencies = await setup();
        const gateResult = await runEvidenceGate(gate, dependencies);
        const suiteResult = await runEvidenceGate(['--suite', 'webllm-real', '--manifest', manifest], dependencies);
        const releaseResult = await runEvidenceGate(['--release', '--manifest', manifest], dependencies);

        expect(gateResult).toMatchObject({
            code: 'execution-unimplemented',
            integratedCommit: head,
        });
        expect([suiteResult.code, releaseResult.code]).toEqual(['execution-unimplemented', 'execution-unimplemented']);
    });

    it('should reject unsafe and stale policies', async () => {
        const escaped = await runEvidenceGate([...gate.slice(0, -1), '../manifest.json'], await setup());
        const stale = await setup();
        await writeFile(join(stale.root, manifest), '{}\n');
        const linked = await setup();
        const manifestPath = join(linked.root, manifest);
        const policyCopy = join(linked.root, 'evidence/agent-campaign/policy-copy.json');
        await rename(manifestPath, policyCopy);
        await symlink(policyCopy, manifestPath);

        const codes = [
            escaped.code,
            (await runEvidenceGate(gate, stale)).code,
            (await runEvidenceGate(gate, linked)).code,
        ];
        expect(codes).toEqual(['unsafe-manifest-path', 'invalid-policy', 'unsafe-manifest-path']);
    });

    it('should redact policy boundary failures', async () => {
        const unreadable = await setup();
        const unresolved = await setup();
        unreadable.fileSystem.readText = () => Promise.reject(new Error('private policy detail'));
        unresolved.fileSystem.realPath = () => Promise.reject(new Error('private root detail'));
        const results = await Promise.all([runEvidenceGate(gate, unreadable), runEvidenceGate(gate, unresolved)]);
        expect(results.map(({ code }) => code)).toEqual(['invalid-policy', 'invalid-policy']);
        expect(results.flatMap(({ failures }) => failures).join()).not.toMatch(/private (policy|root) detail/);
    });

    it('should ignore retained runner output from every head but reject unrelated dirt', async () => {
        const dependencies = await setup();
        execFileSync('git', ['init', '-q'], { cwd: dependencies.root });
        execFileSync('git', ['config', 'user.email', 'runner@example.invalid'], { cwd: dependencies.root });
        execFileSync('git', ['config', 'user.name', 'Evidence Runner'], { cwd: dependencies.root });
        execFileSync('git', ['add', '.'], { cwd: dependencies.root });
        execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: dependencies.root });
        dependencies.checkout = createGitCheckout(dependencies.root);
        const copiedPolicy = await runEvidenceGate(gate, dependencies);
        dependencies.checkout.baselineIsAncestor = () => Promise.resolve(true);
        await mkdir(join(dependencies.root, 'evidence/agent-campaign/runs/old-head'), { recursive: true });
        const retainedPath = join(dependencies.root, 'evidence/agent-campaign/runs/old-head/AC-001.json');
        await writeFile(retainedPath, '{}\n');
        const retainedOutput = await runEvidenceGate(gate, dependencies);
        execFileSync('git', ['add', retainedPath], { cwd: dependencies.root });
        const trackedTamper = await runEvidenceGate(gate, dependencies);

        expect([copiedPolicy.code, retainedOutput.code, trackedTamper.code]).toEqual([
            'invalid-checkout',
            'execution-unimplemented',
            'dirty-checkout',
        ]);
    });

    it('should redact checkout adapter failures', async () => {
        const privateError = () => Promise.reject(new Error('private checkout detail'));
        const results = [];
        for (const method of ['root', 'head', 'baselineIsAncestor', 'dirty'] as const) {
            const failing = await setup();
            failing.checkout = { ...failing.checkout, [method]: privateError };
            results.push(await runEvidenceGate(gate, failing));
        }
        expect(results.map(({ code }) => code)).toEqual([
            'invalid-checkout',
            'invalid-checkout',
            'invalid-checkout',
            'invalid-checkout',
        ]);
        expect(results.flatMap(({ failures }) => failures)).not.toContain('private checkout detail');
    });
});
