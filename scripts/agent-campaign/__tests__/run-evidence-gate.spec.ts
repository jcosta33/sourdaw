import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
        clock: { now: () => new Date('2026-07-26T21:00:00.000Z') },
        checkout: {
            root: () => Promise.resolve(root),
            head: () => Promise.resolve(head),
            baselineIsAncestor: () => Promise.resolve(true),
            dirty: () => Promise.resolve(false),
        },
        environment: { observe: () => Promise.resolve(structuredClone(policy.environment)) },
        ...overrides,
    };
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runEvidenceGate', () => {
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

    it('should materialize observed identity while every executable mode fails closed', async () => {
        const dependencies = await setup();
        const gateResult = await runEvidenceGate(gate, dependencies);
        const suiteResult = await runEvidenceGate(['--suite', 'webllm-real', '--manifest', manifest], dependencies);
        const releaseResult = await runEvidenceGate(['--release', '--manifest', manifest], dependencies);

        expect(gateResult).toMatchObject({
            code: 'executor-unimplemented',
            targetId: 'AC-060',
            integratedCommit: head,
            environmentMatch: true,
        });
        expect(gateResult.runEnvelopeSha256).toMatch(/^[a-f0-9]{64}$/);
        expect([suiteResult.code, releaseResult.code]).toEqual(['executor-unimplemented', 'release-unimplemented']);
    });

    it('should reject unsafe, stale, inapplicable, and unattested inputs', async () => {
        const escaped = await runEvidenceGate([...gate.slice(0, -1), '../manifest.json'], await setup());
        const stale = await setup();
        await writeFile(join(stale.root, manifest), '{}\n');
        const linked = await setup();
        const manifestPath = join(linked.root, manifest);
        const policyCopy = join(linked.root, 'evidence/agent-campaign/policy-copy.json');
        await rename(manifestPath, policyCopy);
        await symlink(policyCopy, manifestPath);
        const unavailable = await setup({ environment: { observe: () => Promise.resolve(null) } });
        const rejected = await setup({ environment: { observe: () => Promise.reject(new Error('private detail')) } });
        const inapplicable = await runEvidenceGate(['--suite', 'openai-real', '--manifest', manifest], await setup());
        const wrongOwner = await runEvidenceGate(
            ['--task', 'TASK-SA-01-command-registry-and-outcomes', '--gate', 'AC-060', '--manifest', manifest],
            await setup()
        );

        const codes = [
            escaped.code,
            (await runEvidenceGate(gate, stale)).code,
            (await runEvidenceGate(gate, linked)).code,
            (await runEvidenceGate(gate, unavailable)).code,
            (await runEvidenceGate(gate, rejected)).code,
            inapplicable.code,
            wrongOwner.code,
        ];
        expect(codes).toEqual([
            'unsafe-manifest-path',
            'invalid-policy',
            'unsafe-manifest-path',
            'environment-unavailable',
            'environment-unavailable',
            'target-inapplicable',
            'unknown-target',
        ]);
        expect((await runEvidenceGate(gate, rejected)).failures).not.toContain('private detail');
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
            'executor-unimplemented',
            'dirty-checkout',
        ]);
    });

    it('should redact checkout adapter failures', async () => {
        const privateError = () => Promise.reject(new Error('private checkout detail'));
        const results = [];
        for (const method of ['root', 'head', 'dirty'] as const) {
            const failing = await setup();
            failing.checkout = { ...failing.checkout, [method]: privateError };
            results.push(await runEvidenceGate(gate, failing));
        }
        expect(results.map(({ code }) => code)).toEqual(['invalid-checkout', 'invalid-checkout', 'invalid-checkout']);
        expect(results.flatMap(({ failures }) => failures)).not.toContain('private checkout detail');
    });
});
