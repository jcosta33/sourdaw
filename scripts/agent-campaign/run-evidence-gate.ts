/// <reference types="node" />

import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { types as utilTypes } from 'node:util';

import { validateEvidenceManifest, validateEvidencePolicy } from './evidenceManifest.ts';
import { generateEvidenceManifest } from './generateEvidenceManifest.ts';

import type { createEvidencePolicy } from './evidenceContract.ts';

type Policy = ReturnType<typeof createEvidencePolicy>;
type RunnerMode =
    | { kind: 'gate'; taskId: string; targetId: string; manifest: string }
    | { kind: 'suite'; targetId: string; manifest: string }
    | { kind: 'release'; manifest: string };

type RunnerFileSystem = {
    readText: (path: string) => Promise<string>;
    realPath: (path: string) => Promise<string>;
};

type Checkout = {
    root: () => Promise<string>;
    head: () => Promise<string>;
    baselineIsAncestor: (baseline: string, head: string) => Promise<boolean>;
    dirty: (ignoredOutputRoot: string) => Promise<boolean>;
};

export type EvidenceExecutor = {
    executable: string;
    arguments: string[];
    fixtureIds: string[];
};
export type ExecutorProcessInput = {
    executable: string;
    arguments: readonly string[];
    cwd: string;
    timeoutMs: number;
    maxBuffer: number;
};
type ExecutorProcessResult = {
    exitStatus: number | null;
    stdout: string;
    stderr: string;
    failed: boolean;
};
type ExecutorSnapshot = Readonly<Omit<EvidenceExecutor, 'arguments' | 'fixtureIds'>> & {
    arguments: readonly string[];
    fixtureIds: readonly string[];
};

type Target = {
    id: string;
    kind: 'gate' | 'suite';
    timeoutMs: number;
    capabilityDecision: string | null;
};

export type EvidenceRunnerDependencies = {
    root: string;
    fileSystem: RunnerFileSystem;
    checkout: Checkout;
    clock: { now: () => Date };
    monotonicClock: { now: () => number };
    environment: { observe: (signal: AbortSignal) => Promise<unknown>; timeoutMs?: number };
    executors: { registry: Record<string, EvidenceExecutor> };
    executorProcess: (input: ExecutorProcessInput) => Promise<ExecutorProcessResult>;
    manifest: { validate: typeof validateEvidenceManifest };
};

export type EvidenceRunnerResult = {
    ok: false;
    exitCode: number;
    code: string;
    failures: string[];
    targetId?: string;
    integratedCommit?: string;
    capturedAt?: string;
    runEnvelopeSha256?: string;
    environmentMatch?: boolean;
    result?: Record<string, unknown>;
};

const COMMIT = /^[a-f0-9]{40}$/;
const CAPTURE_WINDOW_MS = 60_000;
const ENVIRONMENT_TIMEOUT_MS = 5_000;
const EXECUTOR_TIMEOUT_MS = 30_000;
const MAX_STREAM_BYTES = 1_000_000;
const manifestRelativePath = 'evidence/agent-campaign/manifest.json';
const outputRootRelativePath = 'evidence/agent-campaign/runs';

const canonical = (value: unknown): string => `${JSON.stringify(value)}\n`;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

function dataProperty(object: object, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new Error('value is not plain JSON');
    }
    return descriptor.value;
}

function canonicalPlainJson(value: unknown, ancestors = new Set<object>()): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return JSON.stringify(value);
    }
    if (typeof value !== 'object') {
        throw new TypeError('value is not plain JSON');
    }
    if (utilTypes.isProxy(value) || ancestors.has(value)) {
        throw new Error('value is not plain JSON');
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (
                Reflect.getPrototypeOf(value) !== Array.prototype ||
                Reflect.ownKeys(value).length !== value.length + 1
            ) {
                throw new Error('array is not plain JSON');
            }
            const items = Array.from({ length: value.length }, (_, index) =>
                canonicalPlainJson(dataProperty(value, String(index)), ancestors)
            );
            return `[${items.join(',')}]`;
        }

        const prototype = Reflect.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error('object is not plain JSON');
        }
        const keys = Reflect.ownKeys(value);
        if (keys.some((key) => typeof key !== 'string' || key === 'toJSON')) {
            throw new Error('object is not plain JSON');
        }
        const fields = (keys as string[])
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalPlainJson(dataProperty(value, key), ancestors)}`);
        return `{${fields.join(',')}}`;
    } finally {
        ancestors.delete(value);
    }
}

async function observeEnvironment(environment: EvidenceRunnerDependencies['environment']): Promise<unknown> {
    const requestedTimeout = environment.timeoutMs;
    const timeoutMs =
        typeof requestedTimeout === 'number' && Number.isFinite(requestedTimeout) && requestedTimeout > 0
            ? Math.min(requestedTimeout, ENVIRONMENT_TIMEOUT_MS)
            : ENVIRONMENT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutMarker = Symbol('environment-timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof timeoutMarker>((resolve) => {
        timer = setTimeout(() => {
            controller.abort();
            resolve(timeoutMarker);
        }, timeoutMs);
    });
    const observation = Promise.resolve().then(() => environment.observe(controller.signal));
    try {
        const result = await Promise.race([observation, timeout]);
        if (result === timeoutMarker) {
            throw new Error('environment attestation timed out');
        }
        return result;
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
function pendingResult(target: Target, capturedAt: string): Record<string, unknown> {
    return {
        ...genericFailedResult(target, [], capturedAt, capturedAt),
        status: 'pending',
        exitStatus: 3,
        assertionTotals: null,
    };
}

function genericFailedResult(
    target: Target,
    fixtureIds: readonly string[],
    startedAt: string,
    endedAt: string,
    exitStatus: number | null = 1,
    stdout = '',
    stderr = ''
): Record<string, unknown> {
    return {
        resultId: `result.${target.id}`,
        gateOrSuiteId: target.id,
        fixtureIds,
        status: 'failed',
        startedAt,
        endedAt,
        exitStatus,
        stdoutSha256: digest(stdout),
        stderrSha256: digest(stderr),
        assertionTotals: { passed: 0, failed: 1, total: 1 },
        metricSamples: [],
        aggregates: {},
        rawSamplePaths: [],
        environmentMatch: true,
        capabilityDecision: target.capabilityDecision,
        reviewerDisposition: null,
    };
}

function snapshotExecutor(entry: EvidenceExecutor): ExecutorSnapshot | null {
    if (
        !isAbsolute(entry.executable) ||
        !Array.isArray(entry.arguments) ||
        !entry.arguments.every((value) => typeof value === 'string') ||
        !Array.isArray(entry.fixtureIds) ||
        !entry.fixtureIds.every((value) => typeof value === 'string')
    ) {
        return null;
    }
    return Object.freeze({
        executable: entry.executable,
        arguments: Object.freeze([...entry.arguments]),
        fixtureIds: Object.freeze([...entry.fixtureIds]),
    });
}

export function runExecutorProcess(input: ExecutorProcessInput): Promise<ExecutorProcessResult> {
    return new Promise((resolve) => {
        execFile(
            input.executable,
            [...input.arguments],
            {
                cwd: input.cwd,
                encoding: 'utf8',
                timeout: input.timeoutMs,
                maxBuffer: input.maxBuffer,
                killSignal: 'SIGKILL',
            },
            (error, stdout, stderr) => {
                let exitStatus: number | null = 0;
                if (error) {
                    exitStatus = null;
                    if (typeof error.code === 'number') {
                        exitStatus = error.code;
                    }
                }
                resolve({ exitStatus, stdout, stderr, failed: Boolean(error) && exitStatus === null });
            }
        );
    });
}

async function executeTarget(
    target: Target,
    executor: ExecutorSnapshot,
    dependencies: EvidenceRunnerDependencies
): Promise<ExecutorProcessResult & { startedAt: string; endedAt: string }> {
    const startedAt = dependencies.clock.now().toISOString();
    const processResult = await dependencies.executorProcess({
        executable: executor.executable,
        arguments: executor.arguments,
        cwd: dependencies.root,
        timeoutMs: target.timeoutMs,
        maxBuffer: MAX_STREAM_BYTES,
    });
    return { ...processResult, startedAt, endedAt: dependencies.clock.now().toISOString() };
}

function failure(
    code: string,
    exitCode: number,
    failures: string[],
    extra: Partial<EvidenceRunnerResult> = {}
): EvidenceRunnerResult {
    return { ok: false, exitCode, code, failures, ...extra };
}

export function createGitCheckout(root: string): Checkout {
    return {
        root: () =>
            Promise.resolve(
                execFileSync('git', ['rev-parse', '--show-toplevel'], {
                    cwd: root,
                    encoding: 'utf8',
                }).trim()
            ),
        head: () =>
            Promise.resolve(
                execFileSync('git', ['rev-parse', 'HEAD'], {
                    cwd: root,
                    encoding: 'utf8',
                }).trim()
            ),
        baselineIsAncestor: (baseline, head) => {
            const check = spawnSync('git', ['merge-base', '--is-ancestor', baseline, head], {
                cwd: root,
                stdio: 'ignore',
            });
            if (check.error) {
                return Promise.reject(check.error);
            }
            return Promise.resolve(check.status === 0);
        },
        dirty: (ignoredOutputRoot) => {
            const tracked = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
                cwd: root,
                encoding: 'utf8',
            });
            if (tracked.length > 0) {
                return Promise.resolve(true);
            }
            const exclusion = `:(exclude)${ignoredOutputRoot}/**`;
            const output = execFileSync(
                'git',
                ['status', '--porcelain', '--untracked-files=all', '--', '.', exclusion],
                { cwd: root, encoding: 'utf8' }
            );
            return Promise.resolve(output.length > 0);
        },
    };
}

function parseArguments(arguments_: string[]): RunnerMode | null {
    const values = new Map<string, string>();
    const allowed = new Set(['--task', '--gate', '--suite', '--manifest']);
    let release = false;

    for (let index = 0; index < arguments_.length; index += 1) {
        const flag = arguments_[index];
        if (flag === '--release') {
            if (release) {
                return null;
            }
            release = true;
            continue;
        }
        if (!flag || !allowed.has(flag) || values.has(flag)) {
            return null;
        }
        const value = arguments_[index + 1];
        if (!value || value.startsWith('--')) {
            return null;
        }
        values.set(flag, value);
        index += 1;
    }

    const manifest = values.get('--manifest');
    const taskId = values.get('--task');
    const gateId = values.get('--gate');
    const suiteId = values.get('--suite');
    if (!manifest) {
        return null;
    }
    if (release && values.size === 1) {
        return { kind: 'release', manifest };
    }
    if (!release && suiteId && values.size === 2) {
        return { kind: 'suite', targetId: suiteId, manifest };
    }
    if (!release && taskId && gateId && values.size === 3) {
        return { kind: 'gate', taskId, targetId: gateId, manifest };
    }
    return null;
}

async function loadPolicy(
    mode: RunnerMode,
    dependencies: EvidenceRunnerDependencies
): Promise<{ root: string; policy: Policy; policySource: string } | { failure: EvidenceRunnerResult }> {
    try {
        const root = await dependencies.fileSystem.realPath(dependencies.root);
        const canonicalPath = join(root, manifestRelativePath);
        const requestedPath = resolve(root, mode.manifest);
        const relativePath = relative(root, requestedPath);
        const escaped = relativePath.startsWith('..') || isAbsolute(relativePath);
        if (escaped || requestedPath !== canonicalPath) {
            return {
                failure: failure('unsafe-manifest-path', 2, ['manifest must be the canonical repository path']),
            };
        }

        if ((await dependencies.fileSystem.realPath(requestedPath)) !== requestedPath) {
            return {
                failure: failure('unsafe-manifest-path', 2, ['manifest symlinks are forbidden']),
            };
        }
        const policySource = await dependencies.fileSystem.readText(requestedPath);
        const failures = await validateEvidencePolicy(policySource);
        if (failures.length > 0) {
            return { failure: failure('invalid-policy', 2, failures) };
        }
        return { root, policy: JSON.parse(policySource) as Policy, policySource };
    } catch {
        return { failure: failure('invalid-policy', 2, ['policy could not be safely loaded or validated']) };
    }
}

function isRequired(requiredWhen: string, policy: Policy): boolean {
    if (requiredWhen === 'always') {
        return true;
    }
    if (requiredWhen === 'platform == darwin') {
        return policy.environment.platform === 'darwin';
    }
    const match = /^capability\.([a-z0-9-]+) == admitted$/.exec(requiredWhen);
    const capability = policy.capabilities.find(({ id }) => id === match?.[1]);
    return Boolean(match && capability?.status === 'admitted');
}

function validateTarget(mode: RunnerMode, policy: Policy): EvidenceRunnerResult | Target | null {
    if (mode.kind === 'release') {
        return null;
    }
    if (mode.kind === 'gate') {
        const gate = policy.inventories.gates.entries.find(({ gateId }) => gateId === mode.targetId);
        if (!gate || gate.owningTask !== mode.taskId) {
            return failure('unknown-target', 2, ['gate and owning task must match the frozen inventory']);
        }
        const pending = policy.inventories.results.entries.find(({ gateOrSuiteId }) => gateOrSuiteId === gate.gateId);
        if (!pending) {
            return failure('unknown-target', 2, ['gate result must exist in the frozen inventory']);
        }
        return {
            id: gate.gateId,
            kind: 'gate',
            timeoutMs: gate.timeoutMs,
            capabilityDecision: null,
        };
    }
    const suite = policy.suites.find(({ id }) => id === mode.targetId);
    if (!suite) {
        return failure('unknown-target', 2, ['suite must exist in the frozen inventory']);
    }
    if (!isRequired(suite.requiredWhen, policy)) {
        return failure('target-inapplicable', 2, ['frozen requiredWhen mechanically evaluates false']);
    }
    const pending = policy.inventories.results.entries.find(({ gateOrSuiteId }) => gateOrSuiteId === suite.id);
    if (!pending) {
        return failure('unknown-target', 2, ['suite result must exist in the frozen inventory']);
    }
    const capability = policy.capabilities.find(({ id }) => id === suite.capabilityId);
    const capabilityValue: unknown = capability;
    let capabilityDecision: string | null = null;
    if (isRecord(capabilityValue) && typeof capabilityValue.status === 'string') {
        capabilityDecision = capabilityValue.status;
    }
    return {
        id: suite.id,
        kind: 'suite',
        timeoutMs: EXECUTOR_TIMEOUT_MS,
        capabilityDecision,
    };
}

export async function runEvidenceGate(
    arguments_: string[],
    dependencies: EvidenceRunnerDependencies
): Promise<EvidenceRunnerResult> {
    const mode = parseArguments(arguments_);
    if (!mode) {
        return failure('invalid-arguments', 2, ['use exactly task+gate, suite, or release with one manifest']);
    }

    const loaded = await loadPolicy(mode, dependencies);
    if ('failure' in loaded) {
        return loaded.failure;
    }

    let head: string;
    try {
        const checkoutRoot = await dependencies.fileSystem.realPath(await dependencies.checkout.root());
        head = await dependencies.checkout.head();
        const baselineMatches = await dependencies.checkout.baselineIsAncestor(
            loaded.policy.identity.baselineCommit,
            head
        );
        if (checkoutRoot !== loaded.root || !COMMIT.test(head) || !baselineMatches) {
            return failure('invalid-checkout', 2, ['checkout identity could not be verified']);
        }
        if (await dependencies.checkout.dirty(outputRootRelativePath)) {
            return failure('dirty-checkout', 2, ['checkout contains unrelated changes']);
        }
    } catch {
        return failure('invalid-checkout', 2, ['checkout identity could not be verified']);
    }

    const target = validateTarget(mode, loaded.policy);
    if (target && 'ok' in target) {
        return target;
    }

    let capturedAt: string;
    let monotonicStart: number;
    let envelopeSource: string;
    try {
        monotonicStart = dependencies.monotonicClock.now();
        capturedAt = dependencies.clock.now().toISOString();
        envelopeSource = generateEvidenceManifest({
            policySource: loaded.policySource,
            observedCommit: head,
            observedDirty: false,
            capturedAt,
        });
    } catch {
        return failure('invalid-run-envelope', 2, ['run envelope could not be verified'], {
            integratedCommit: head,
        });
    }
    const runEnvelopeSha256 = digest(envelopeSource);
    let environmentMatch: boolean;
    try {
        const observedEnvironment = await observeEnvironment(dependencies.environment);
        environmentMatch =
            digest(canonicalPlainJson(observedEnvironment)) === digest(canonicalPlainJson(loaded.policy.environment));
    } catch {
        return failure('environment-unavailable', 4, ['environment attestation could not be verified'], {
            integratedCommit: head,
            capturedAt,
            runEnvelopeSha256,
            environmentMatch: false,
        });
    }

    let envelopeFailures: string[];
    try {
        const observedNow = dependencies.clock.now().toISOString();
        envelopeFailures = await dependencies.manifest.validate({
            source: envelopeSource,
            policySource: loaded.policySource,
            observedCommit: head,
            observedDirty: false,
            observedCapturedAt: capturedAt,
            observedNow,
            releaseReady: false,
        });
    } catch {
        return failure('invalid-run-envelope', 2, ['run envelope could not be verified'], {
            integratedCommit: head,
            capturedAt,
            runEnvelopeSha256,
            environmentMatch,
        });
    }
    const context = {
        integratedCommit: head,
        capturedAt,
        runEnvelopeSha256,
        environmentMatch,
    };
    let result = target ? pendingResult(target, capturedAt) : {};
    let terminalCode = 'executor-unimplemented';
    let terminalExitCode = 3;
    const mayExecute = target && envelopeFailures.length === 0 && environmentMatch && mode.kind !== 'release';
    const entry = mayExecute ? dependencies.executors.registry[target.id] : undefined;
    if (entry && target) {
        const executor = snapshotExecutor(entry);
        const declaredFixtureIds = new Set(
            loaded.policy.inventories.fixtures.entries.map(({ fixtureId }) => fixtureId)
        );
        const fixtureIdsAreValid =
            executor !== null &&
            new Set(executor.fixtureIds).size === executor.fixtureIds.length &&
            executor.fixtureIds.every((id) => declaredFixtureIds.has(id));
        if (!executor || !fixtureIdsAreValid) {
            result = genericFailedResult(target, [], capturedAt, capturedAt);
            terminalCode = 'invalid-executor-result';
            terminalExitCode = 2;
        } else {
            let execution: Awaited<ReturnType<typeof executeTarget>>;
            try {
                execution = await executeTarget(target, executor, dependencies);
            } catch {
                execution = {
                    startedAt: capturedAt,
                    endedAt: capturedAt,
                    exitStatus: null,
                    stdout: '',
                    stderr: '',
                    failed: true,
                };
            }
            result = genericFailedResult(
                target,
                executor.fixtureIds,
                execution.startedAt,
                execution.endedAt,
                execution.exitStatus,
                execution.stdout,
                execution.stderr
            );
            if (execution.failed) {
                terminalCode = 'executor-failed';
                terminalExitCode = 1;
            } else {
                terminalCode = 'normalization-unimplemented';
                terminalExitCode = 3;
            }
        }
    }

    try {
        const finalHeadBeforeDirty = await dependencies.checkout.head();
        if (finalHeadBeforeDirty !== head) {
            return failure('invalid-checkout', 2, ['checkout identity could not be verified']);
        }
        const finalDirty = await dependencies.checkout.dirty(outputRootRelativePath);
        const finalHeadAfterDirty = await dependencies.checkout.head();
        if (finalHeadAfterDirty !== head) {
            return failure('invalid-checkout', 2, ['checkout identity could not be verified']);
        }
        if (finalDirty) {
            return failure('dirty-checkout', 2, ['checkout contains unrelated changes']);
        }
    } catch {
        return failure('invalid-checkout', 2, ['checkout identity could not be verified']);
    }
    let finalCaptureIsFresh: boolean;
    try {
        const handoffNow = dependencies.clock.now().toISOString();
        const finalElapsed = Date.parse(handoffNow) - Date.parse(capturedAt);
        const monotonicElapsed = dependencies.monotonicClock.now() - monotonicStart;
        finalCaptureIsFresh =
            finalElapsed >= 0 &&
            finalElapsed <= CAPTURE_WINDOW_MS &&
            monotonicElapsed >= 0 &&
            monotonicElapsed <= CAPTURE_WINDOW_MS;
    } catch {
        return failure('invalid-run-envelope', 2, ['run envelope could not be verified'], {
            integratedCommit: head,
            capturedAt,
            runEnvelopeSha256,
            environmentMatch,
        });
    }
    if (envelopeFailures.length > 0 || !finalCaptureIsFresh) {
        return failure('invalid-run-envelope', 2, ['run envelope could not be verified'], context);
    }
    if (!environmentMatch) {
        return failure('environment-unavailable', 4, ['environment attestation could not be verified'], context);
    }
    if (mode.kind === 'release') {
        return failure('release-unimplemented', 3, ['release aggregation is not registered'], context);
    }
    if (!target) {
        return failure('unknown-target', 2, ['target must exist in the frozen inventory'], context);
    }
    return {
        ok: false,
        exitCode: terminalExitCode,
        code: terminalCode,
        failures: [terminalCode],
        ...context,
        targetId: target.id,
        result,
    };
}

async function isCliInvocation(entrypoint: string | undefined): Promise<boolean> {
    if (!entrypoint) {
        return false;
    }
    try {
        return import.meta.url === pathToFileURL(await realpath(entrypoint)).href;
    } catch {
        return false;
    }
}

if (await isCliInvocation(process.argv[1])) {
    const root = process.cwd();
    const output = await runEvidenceGate(process.argv.slice(2), {
        root,
        fileSystem: {
            readText: (path) => readFile(path, 'utf8'),
            realPath: (path) => realpath(path),
        },
        checkout: createGitCheckout(root),
        clock: { now: () => new Date() },
        monotonicClock: { now: () => performance.now() },
        environment: {
            observe: (_signal) => Promise.reject(new Error('environment attestor is not registered')),
        },
        executors: { registry: {} },
        executorProcess: runExecutorProcess,
        manifest: { validate: validateEvidenceManifest },
    });
    process.stdout.write(canonical(output));
    process.exitCode = output.exitCode;
}
