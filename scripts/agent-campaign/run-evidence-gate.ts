/// <reference types="node" />

import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateEvidencePolicy } from './evidenceManifest.ts';

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
    checkout: Checkout;
};

export type EvidenceRunnerResult = {
    ok: false;
    exitCode: number;
    code: string;
    failures: string[];
    integratedCommit?: string;
};

const COMMIT = /^[a-f0-9]{40}$/;
const manifestRelativePath = 'evidence/agent-campaign/manifest.json';
const outputRootRelativePath = 'evidence/agent-campaign/runs';

const canonical = (value: unknown): string => `${JSON.stringify(value)}\n`;

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
): Promise<{ root: string; policy: Policy } | { failure: EvidenceRunnerResult }> {
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
        return { root, policy: JSON.parse(policySource) as Policy };
    } catch {
        return { failure: failure('invalid-policy', 2, ['policy could not be safely loaded or validated']) };
    }
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

    return failure('execution-unimplemented', 3, ['target and environment attestation are not registered'], {
        integratedCommit: head,
    });
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
    });
    process.stdout.write(canonical(output));
    process.exitCode = output.exitCode;
}
