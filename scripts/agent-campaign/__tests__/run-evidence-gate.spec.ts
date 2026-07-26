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
const captureTime = '2026-07-27T12:00:00.000Z';

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
        clock: { now: () => new Date(captureTime) },
        environment: { observe: () => Promise.resolve(structuredClone(policy.environment)) },
        ...overrides,
    };
}

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }))
    );
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

    it('should bind a valid run envelope and environment before typed terminal outcomes', async () => {
        const calls: string[] = [];
        const policy = createEvidencePolicy();
        const dependencies = await setup({
            clock: {
                now: () => {
                    calls.push('clock');
                    return new Date(captureTime);
                },
            },
            environment: {
                observe: () => {
                    calls.push('environment');
                    return Promise.resolve(structuredClone(policy.environment));
                },
            },
        });
        const gateResult = await runEvidenceGate(gate, dependencies);

        expect(gateResult).toMatchObject({
            code: 'executor-unimplemented',
            targetId: 'AC-060',
            integratedCommit: head,
            capturedAt: captureTime,
            environmentMatch: true,
        });
        expect(gateResult.runEnvelopeSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(calls).toEqual(['clock', 'environment', 'clock']);

        const suiteResult = await runEvidenceGate(['--suite', 'webllm-real', '--manifest', manifest], await setup());
        const releaseResult = await runEvidenceGate(['--release', '--manifest', manifest], await setup());
        expect([suiteResult.code, releaseResult.code]).toEqual(['executor-unimplemented', 'release-unimplemented']);
    });

    it('should reject unknown, wrongly owned, and mechanically inapplicable targets', async () => {
        const argumentsByCase = [
            ['--task', 'TASK-SA-01-command-registry-and-outcomes', '--gate', 'AC-060', '--manifest', manifest],
            ['--task', 'TASK-SA-00-protocol-governance', '--gate', 'AC-999', '--manifest', manifest],
            ['--suite', 'unknown-suite', '--manifest', manifest],
            ['--suite', 'openai-real', '--manifest', manifest],
        ];
        const results = await Promise.all(
            argumentsByCase.map(async (arguments_) => runEvidenceGate(arguments_, await setup()))
        );
        expect(results.map(({ code }) => code)).toEqual([
            'unknown-target',
            'unknown-target',
            'unknown-target',
            'target-inapplicable',
        ]);
    });

    it('should redact rejected, mismatched, and non-JSON environment attestations', async () => {
        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;
        let toJsonCalled = false;
        const withToJson = { toJSON: () => (toJsonCalled = true) };
        let accessorCalled = false;
        const withAccessor = Object.defineProperty({}, 'secret', {
            enumerable: true,
            get: () => {
                accessorCalled = true;
                throw new Error('private accessor detail');
            },
        });
        const malformed = [
            {},
            1n,
            cyclic,
            withToJson,
            withAccessor,
            { value: undefined },
            { value: Symbol('private') },
            { value: () => 'private' },
            { value: Number.NaN },
            { value: Number.POSITIVE_INFINITY },
            Object.create({ inherited: true }),
            Object.setPrototypeOf([], {}),
        ];
        const results = await Promise.all([
            runEvidenceGate(
                gate,
                await setup({ environment: { observe: () => Promise.reject(new Error('private')) } })
            ),
            ...malformed.map(async (value) =>
                runEvidenceGate(gate, await setup({ environment: { observe: () => Promise.resolve(value) } }))
            ),
        ]);

        expect(results.map(({ code }) => code).every((code) => code === 'environment-unavailable')).toBe(true);
        expect(results.flatMap(({ failures }) => failures).join()).not.toMatch(/private|accessor/);
        expect([toJsonCalled, accessorCalled]).toEqual([false, false]);
    });

    it.each([
        ['future', -1, 'invalid-run-envelope'],
        ['current', 0, 'executor-unimplemented'],
        ['at 60 seconds', 60_000, 'executor-unimplemented'],
        ['over 60 seconds', 60_001, 'invalid-run-envelope'],
    ])('should classify a %s capture using an independent clock sample', async (_case, elapsed, expectedCode) => {
        const start = Date.parse(captureTime);
        const samples = [new Date(start), new Date(start + elapsed)];
        let index = 0;
        const dependencies = await setup({ clock: { now: () => samples[index++] ?? samples[1] } });

        expect((await runEvidenceGate(gate, dependencies)).code).toBe(expectedCode);
        expect(index).toBe(2);
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
        const unrelatedPath = join(dependencies.root, 'unrelated.txt');
        await writeFile(unrelatedPath, 'untracked\n');
        const untrackedDirt = await runEvidenceGate(gate, dependencies);
        await rm(unrelatedPath);
        execFileSync('git', ['add', retainedPath], { cwd: dependencies.root });
        const trackedTamper = await runEvidenceGate(gate, dependencies);

        expect([copiedPolicy.code, retainedOutput.code, untrackedDirt.code, trackedTamper.code]).toEqual([
            'invalid-checkout',
            'executor-unimplemented',
            'dirty-checkout',
            'dirty-checkout',
        ]);
    });

    it('should reject a mismatched root and malformed HEAD', async () => {
        const wrongRoot = await setup();
        const malformedHead = await setup();
        const otherRoot = await mkdtemp(join(tmpdir(), 'sourdaw-evidence-runner-other-'));
        roots.push(otherRoot);
        wrongRoot.checkout.root = () => Promise.resolve(otherRoot);
        malformedHead.checkout.head = () => Promise.resolve('not-a-commit');

        const results = await Promise.all([runEvidenceGate(gate, wrongRoot), runEvidenceGate(gate, malformedHead)]);
        expect(results.map(({ code }) => code)).toEqual(['invalid-checkout', 'invalid-checkout']);
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
        expect(results.flatMap(({ failures }) => failures).join()).not.toMatch(/private checkout detail/);
    });
});
