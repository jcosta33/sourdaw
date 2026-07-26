/// <reference types="node" />

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export type EvidenceRunnerDependencies = {
    root: string;
    fileSystem: RunnerFileSystem;
    clock: { now: () => Date };
    checkout: Checkout;
    environment: { observe: () => Promise<unknown> };
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
};

const COMMIT = /^[a-f0-9]{40}$/;
const manifestRelativePath = 'evidence/agent-campaign/manifest.json';
const outputRootRelativePath = 'evidence/agent-campaign/runs';

const canonical = (value: unknown): string => `${JSON.stringify(value)}\n`;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

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
): Promise<{ root: string; policySource: string; policy: Policy } | { failure: EvidenceRunnerResult }> {
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

    try {
        if ((await dependencies.fileSystem.realPath(requestedPath)) !== requestedPath) {
            return {
                failure: failure('unsafe-manifest-path', 2, ['manifest symlinks are forbidden']),
            };
        }
    } catch {
        return {
            failure: failure('unsafe-manifest-path', 2, ['manifest path is missing or ambiguous']),
        };
    }

    const policySource = await dependencies.fileSystem.readText(requestedPath);
    const failures = await validateEvidencePolicy(policySource);
    if (failures.length > 0) {
        return { failure: failure('invalid-policy', 2, failures) };
    }
    return { root, policySource, policy: JSON.parse(policySource) as Policy };
}

function isRequired(requiredWhen: string, policy: Policy): boolean {
    if (requiredWhen === 'always') {
        return true;
    }
    if (requiredWhen === 'platform == darwin') {
        return policy.environment.platform === 'darwin';
    }

    const match = /^capability\.([a-z0-9-]+) == admitted$/.exec(requiredWhen);
    if (!match) {
        throw new Error(`unsupported requiredWhen expression: ${requiredWhen}`);
    }
    const capability = policy.capabilities.find(({ id }) => id === match[1]);
    return capability?.status === 'admitted';
}

function validateTarget(mode: RunnerMode, policy: Policy): EvidenceRunnerResult | { id: string } | null {
    if (mode.kind === 'release') {
        return null;
    }
    if (mode.kind === 'gate') {
        const gate = policy.inventories.gates.entries.find(({ gateId }) => gateId === mode.targetId);
        if (!gate || gate.owningTask !== mode.taskId) {
            return failure('unknown-target', 2, ['gate and owning task must match the frozen inventory']);
        }
        return { id: gate.gateId };
    }

    const suite = policy.suites.find(({ id }) => id === mode.targetId);
    if (!suite) {
        return failure('unknown-target', 2, ['suite must exist in the frozen inventory']);
    }
    if (!isRequired(suite.requiredWhen, policy)) {
        return failure('target-inapplicable', 2, ['frozen requiredWhen mechanically evaluates false']);
    }
    return { id: suite.id };
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

    const capturedAt = dependencies.clock.now().toISOString();
    const envelopeSource = generateEvidenceManifest({
        policySource: loaded.policySource,
        observedCommit: head,
        observedDirty: false,
        capturedAt,
    });
    const envelopeFailures = await validateEvidenceManifest({
        source: envelopeSource,
        policySource: loaded.policySource,
        observedCommit: head,
        observedDirty: false,
        observedCapturedAt: capturedAt,
        observedNow: capturedAt,
        releaseReady: false,
    });
    if (envelopeFailures.length > 0) {
        return failure('invalid-run-envelope', 2, envelopeFailures);
    }

    let observedEnvironment: unknown;
    try {
        observedEnvironment = await dependencies.environment.observe();
    } catch {
        return failure('environment-unavailable', 4, ['environment attestation failed'], {
            integratedCommit: head,
            capturedAt,
            runEnvelopeSha256: digest(envelopeSource),
            environmentMatch: false,
        });
    }
    const environmentMatch =
        observedEnvironment !== null &&
        digest(canonical(observedEnvironment)) === digest(canonical(loaded.policy.environment));
    const context = {
        integratedCommit: head,
        capturedAt,
        runEnvelopeSha256: digest(envelopeSource),
        environmentMatch,
    };
    if (!environmentMatch) {
        return failure('environment-unavailable', 4, ['observed environment is unavailable or mismatched'], context);
    }
    if (mode.kind === 'release') {
        return failure('release-unimplemented', 3, ['release aggregation is not registered'], context);
    }
    return failure('executor-unimplemented', 3, ['trusted executor is not registered'], {
        ...context,
        targetId: target?.id,
    });
}

const isCli = import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
    const root = process.cwd();
    const output = await runEvidenceGate(process.argv.slice(2), {
        root,
        fileSystem: {
            readText: (path) => readFile(path, 'utf8'),
            realPath: (path) => realpath(path),
        },
        clock: { now: () => new Date() },
        checkout: createGitCheckout(root),
        environment: { observe: () => Promise.resolve(null) },
    });
    process.stdout.write(canonical(output));
    process.exitCode = output.exitCode;
}
