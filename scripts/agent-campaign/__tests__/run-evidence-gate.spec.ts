import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createEvidencePolicy } from '../evidenceContract';
import { validateEvidenceManifest } from '../evidenceManifest';
import {
    createGitCheckout,
    runEvidenceGate,
    type EvidenceExecutor,
    type EvidenceRunnerDependencies,
} from '../run-evidence-gate';

const head = 'a'.repeat(40);
const roots: string[] = [];
const manifest = 'evidence/agent-campaign/manifest.json';
const gate = ['--task', 'TASK-SA-00-protocol-governance', '--gate', 'AC-060', '--manifest', manifest];
const browserSuite = ['--suite', 'browser-ui', '--manifest', manifest];
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
        monotonicClock: { now: () => 0 },
        environment: { observe: (_signal: AbortSignal) => Promise.resolve(structuredClone(policy.environment)) },
        executors: { registry: {} },
        manifest: { validate: validateEvidenceManifest },
        ...overrides,
    };
}

function executorObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        status: 'passed',
        exitStatus: 0,
        stdout: 'private-token',
        stderr: '',
        assertionTotals: { passed: 1, failed: 0, total: 1 },
        metricSamples: [],
        aggregates: {},
        rawSamplePaths: [],
        capabilityDecision: null,
        reviewerDisposition: null,
        ...overrides,
    };
}

async function runWithExecutor(execute?: EvidenceExecutor, fixtureIds: string[] = []) {
    const dependencies = await setup();
    if (execute) {
        dependencies.executors.registry = { 'browser-ui': { fixtureIds, execute } };
    }
    return runEvidenceGate(execute ? browserSuite : gate, dependencies);
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
        expect(calls).toEqual(['clock', 'environment', 'clock', 'clock']);

        const suiteResult = await runEvidenceGate(['--suite', 'webllm-real', '--manifest', manifest], await setup());
        const releaseResult = await runEvidenceGate(['--release', '--manifest', manifest], await setup());
        expect([suiteResult.code, releaseResult.code]).toEqual(['executor-unimplemented', 'release-unimplemented']);
    });

    it('should return a runner-owned pending result without executing manifest commands', async () => {
        expect(await runWithExecutor()).toMatchObject({
            code: 'executor-unimplemented',
            exitCode: 3,
            result: {
                resultId: 'result.AC-060',
                gateOrSuiteId: 'AC-060',
                fixtureIds: [],
                status: 'pending',
                startedAt: captureTime,
                endedAt: captureTime,
                exitStatus: 3,
                assertionTotals: null,
                environmentMatch: true,
            },
        });
    });

    it.each([
        ['passed', {}, 'persistence-unimplemented', 3],
        [
            'failed',
            {
                status: 'failed',
                exitStatus: 1,
                assertionTotals: { passed: 0, failed: 1, total: 1 },
            },
            'executor-failed',
            1,
        ],
    ])(
        'should normalize a strict %s observation without retaining streams',
        async (_case, overrides, code, exitCode) => {
            let input: unknown;
            const output = await runWithExecutor((value) => {
                input = value;
                return Promise.resolve(executorObservation(overrides));
            });

            expect(output).toMatchObject({ code, exitCode, result: { ...overrides, environmentMatch: true } });
            expect(input).toMatchObject({ targetId: 'browser-ui', kind: 'suite', timeoutMs: 30_000 });
            expect(Object.keys(input as object).sort()).toEqual(['kind', 'signal', 'targetId', 'timeoutMs']);
            expect(output.result?.stdoutSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(JSON.stringify(output)).not.toContain('private-token');
        }
    );

    it('should use a fixed trusted suite timeout and frozen capability disposition', async () => {
        const dependencies = await setup();
        let input: unknown;
        dependencies.executors.registry = {
            'webllm-real': {
                fixtureIds: [],
                execute: (value) => {
                    input = value;
                    return Promise.resolve(executorObservation({ capabilityDecision: 'mandatory' }));
                },
            },
        };
        const output = await runEvidenceGate(['--suite', 'webllm-real', '--manifest', manifest], dependencies);

        expect(output).toMatchObject({
            code: 'persistence-unimplemented',
            result: { capabilityDecision: 'mandatory' },
        });
        expect(input).toMatchObject({ kind: 'suite', timeoutMs: 30_000 });
    });

    it('should reject an incompatible frozen gate timeout without invoking its executor', async () => {
        const dependencies = await setup();
        let called = false;
        dependencies.executors.registry = {
            'AC-060': {
                fixtureIds: [],
                execute: () => {
                    called = true;
                    return Promise.resolve(executorObservation());
                },
            },
        };

        const output = await runEvidenceGate(gate, dependencies);
        expect([output.code, output.exitCode, called]).toEqual(['executor-timeout-incompatible', 2, false]);
    });

    it.each([
        ['thrown', () => Promise.reject(new Error('private-token'))],
        [
            'timed out',
            ({ signal }: Parameters<EvidenceExecutor>[0]) =>
                new Promise((resolve) => signal.addEventListener('abort', resolve)),
        ],
    ])('should return a generic redacted result when execution is %s', async (_case, execute) => {
        const dependencies = await setup();
        dependencies.executors.timeoutMs = 5;
        dependencies.executors.registry = { 'browser-ui': { fixtureIds: [], execute } };
        const output = await runEvidenceGate(browserSuite, dependencies);

        expect(output).toMatchObject({
            code: 'executor-failed',
            exitCode: 1,
            result: {
                status: 'failed',
                startedAt: captureTime,
                endedAt: captureTime,
                assertionTotals: { passed: 0, failed: 1, total: 1 },
            },
        });
        expect(JSON.stringify(output)).not.toContain('private-token');
    });

    it.each([
        ['self-waived', { status: 'pending' }],
        ['inapplicable', { status: 'inapplicable' }],
        ['assertions', { assertionTotals: { passed: 1, failed: 1, total: 1 } }],
        ['metrics', { metricSamples: [{ id: 'duration', value: 1 }] }],
        ['aggregates', { aggregates: { duration: 1 } }],
        ['sample paths', { rawSamplePaths: ['samples/private'] }],
        ['capability waiver', { capabilityDecision: 'unadmitted' }],
        ['review waiver', { reviewerDisposition: 'waived' }],
        ['extra raw field', { raw: 'private-token' }],
    ])('should replace a malformed %s observation with a generic failure', async (_case, overrides) => {
        const output = await runWithExecutor(() => Promise.resolve(executorObservation(overrides)));
        expect(output).toMatchObject({
            code: 'invalid-executor-result',
            exitCode: 2,
            result: { status: 'failed' },
        });
        expect(JSON.stringify(output)).not.toMatch(/private-token|samples\/private|waived/);
    });

    it('should reject undeclared fixtures before invoking the executor', async () => {
        let called = false;
        const output = await runWithExecutor(() => {
            called = true;
            return Promise.resolve(executorObservation());
        }, ['private-fixture']);

        expect([output.code, called]).toEqual(['invalid-executor-result', false]);
        expect(JSON.stringify(output)).not.toContain('private-fixture');
    });

    it.each(['head', 'dirty'])('should discard results when checkout %s changes during execution', async (change) => {
        const dependencies = await setup();
        let currentHead = head;
        let dirty = false;
        dependencies.checkout.head = () => Promise.resolve(currentHead);
        dependencies.checkout.dirty = () => Promise.resolve(dirty);
        dependencies.executors.registry = {
            'browser-ui': {
                fixtureIds: [],
                execute: () => {
                    currentHead = change === 'head' ? 'b'.repeat(40) : head;
                    dirty = change === 'dirty';
                    return Promise.resolve(executorObservation());
                },
            },
        };
        const output = await runEvidenceGate(browserSuite, dependencies);

        expect(output.result).toBeUndefined();
        expect(output.code).toBe(change === 'head' ? 'invalid-checkout' : 'dirty-checkout');
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
        const policy = createEvidencePolicy();
        let proxyTraps = 0;
        const proxyEnvironment = new Proxy(structuredClone(policy.environment), {
            getPrototypeOf: (target) => {
                proxyTraps += 1;
                return Reflect.getPrototypeOf(target);
            },
            ownKeys: (target) => {
                proxyTraps += 1;
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor: (target, key) => {
                proxyTraps += 1;
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
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
            proxyEnvironment,
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
        expect(proxyTraps).toBe(0);
    });

    it('should abort a bounded observation and handle rejection after timeout', async () => {
        let neverSignal: AbortSignal | undefined;
        const neverSettles = await setup({
            environment: {
                timeoutMs: 5,
                observe: (signal) => {
                    neverSignal = signal;
                    return new Promise(() => undefined);
                },
            },
        });
        const rejectsLate = await setup({
            environment: {
                timeoutMs: 5,
                observe: (signal) =>
                    new Promise((_resolve, reject) => {
                        signal.addEventListener('abort', () => queueMicrotask(() => reject(new Error('private late'))));
                    }),
            },
        });
        const results = await Promise.all([runEvidenceGate(gate, neverSettles), runEvidenceGate(gate, rejectsLate)]);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(results.map(({ code }) => code)).toEqual(['environment-unavailable', 'environment-unavailable']);
        expect(neverSignal?.aborted).toBe(true);
        expect(results.flatMap(({ failures }) => failures).join()).not.toMatch(/private|timeout/);
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
        expect(index).toBe(3);
    });

    it('should reject a capture that becomes stale during manifest validation', async () => {
        const start = Date.parse(captureTime);
        const samples = [new Date(start), new Date(start), new Date(start + 60_001)];
        let index = 0;
        const dependencies = await setup({ clock: { now: () => samples[index++] ?? samples[2] } });
        const validate = dependencies.manifest.validate;
        dependencies.manifest.validate = async (input) => {
            await Promise.resolve();
            return validate(input);
        };

        expect((await runEvidenceGate(gate, dependencies)).code).toBe('invalid-run-envelope');
        expect(index).toBe(3);
    });

    it('should reject HEAD changes and dirt introduced during manifest validation', async () => {
        let currentHead = head;
        let dirty = false;
        const changedHead = await setup();
        changedHead.checkout.head = () => Promise.resolve(currentHead);
        const validateHead = changedHead.manifest.validate;
        changedHead.manifest.validate = async (input) => {
            const failures = await validateHead(input);
            currentHead = 'b'.repeat(40);
            return failures;
        };

        const changedTree = await setup();
        changedTree.checkout.dirty = () => Promise.resolve(dirty);
        const validateTree = changedTree.manifest.validate;
        changedTree.manifest.validate = async (input) => {
            const failures = await validateTree(input);
            dirty = true;
            return failures;
        };

        const results = await Promise.all([runEvidenceGate(gate, changedHead), runEvidenceGate(gate, changedTree)]);
        expect(results.map(({ code }) => code)).toEqual(['invalid-checkout', 'dirty-checkout']);
    });

    it('should reject HEAD changes made by the final dirty probe', async () => {
        let currentHead = head;
        let dirtyReads = 0;
        const dependencies = await setup();
        dependencies.checkout.head = () => Promise.resolve(currentHead);
        dependencies.checkout.dirty = () => {
            dirtyReads += 1;
            if (dirtyReads === 2) {
                currentHead = 'b'.repeat(40);
            }
            return Promise.resolve(false);
        };

        expect((await runEvidenceGate(gate, dependencies)).code).toBe('invalid-checkout');
    });

    it.each([
        ['frozen', 0, 60_001],
        ['stepped', 1_000, 60_001],
        ['backward', 0, -1],
    ])('should reject %s wall time with invalid monotonic elapsed', async (_case, wallStep, monotonicElapsed) => {
        const start = Date.parse(captureTime);
        const wallSamples = [new Date(start), new Date(start + wallStep), new Date(start + wallStep * 2)];
        const monotonicSamples = [0, monotonicElapsed];
        let wallIndex = 0;
        let monotonicIndex = 0;
        const dependencies = await setup({
            clock: { now: () => wallSamples[wallIndex++] ?? wallSamples[2] },
            monotonicClock: { now: () => monotonicSamples[monotonicIndex++] ?? monotonicSamples[1] },
        });

        expect((await runEvidenceGate(gate, dependencies)).code).toBe('invalid-run-envelope');
        expect([wallIndex, monotonicIndex]).toEqual([3, 2]);
    });

    it('should redact final checkout adapter failures', async () => {
        const headFailure = await setup();
        let headReads = 0;
        headFailure.checkout.head = () => {
            headReads += 1;
            return headReads === 1 ? Promise.resolve(head) : Promise.reject(new Error('private final head'));
        };
        const dirtyFailure = await setup();
        let dirtyReads = 0;
        dirtyFailure.checkout.dirty = () => {
            dirtyReads += 1;
            return dirtyReads === 1 ? Promise.resolve(false) : Promise.reject(new Error('private final dirty'));
        };

        const results = await Promise.all([runEvidenceGate(gate, headFailure), runEvidenceGate(gate, dirtyFailure)]);
        expect(results.map(({ code }) => code)).toEqual(['invalid-checkout', 'invalid-checkout']);
        expect(results.flatMap(({ failures }) => failures).join()).not.toMatch(/private final/);
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
