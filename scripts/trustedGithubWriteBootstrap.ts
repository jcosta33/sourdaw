#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TrustedGithubWriteCommand = 'deliver' | 'issue:reconcile';

type TrustedSourcePort = {
    readSource: (path: string) => string;
    originMainSource: (path: string) => string | undefined;
    loadCommand: (command: TrustedGithubWriteCommand) => Promise<(args: string[]) => Promise<number>>;
};

const trustedDependencyGraphs: Record<TrustedGithubWriteCommand, readonly string[]> = {
    deliver: [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/deliverPullRequest.ts',
        'scripts/reconcileTrackerIssue.ts',
        'scripts/trackerIssueReconciliation.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'issue:reconcile': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/reconcileTrackerIssue.ts',
        'scripts/trackerIssueReconciliation.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
};

export function trustedDependencyPaths(command: TrustedGithubWriteCommand): readonly string[] {
    return trustedDependencyGraphs[command];
}

export function assertTrustedSourceGraph(
    command: TrustedGithubWriteCommand,
    port: Omit<TrustedSourcePort, 'loadCommand'>
): void {
    const paths = trustedDependencyPaths(command);
    const pathSet = new Set(paths);
    const sources = new Map(paths.map((path) => [path, port.readSource(path)]));
    for (const path of paths) {
        const originSource = port.originMainSource(path);
        if (originSource !== undefined && sources.get(path) !== originSource) {
            throw new Error(`${path} does not match origin/main; refusing to run a mutated copy`);
        }
    }
    for (const [path, source] of sources) {
        if (path === 'scripts/trustedGithubWriteBootstrap.ts') {
            continue;
        }
        for (const dependency of localModuleDependencies(path, source)) {
            if (!pathSet.has(dependency)) {
                throw new Error(`${path} imports unchecked local dependency ${dependency}`);
            }
        }
    }
}

function localModuleDependencies(path: string, source: string): string[] {
    const specifiers = new Set<string>();
    const patterns = [
        /\bfrom\s+['"](\.[^'"]+)['"]/g,
        /\bimport\s+['"](\.[^'"]+)['"]/g,
        /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const specifier = match[1];
            if (specifier !== undefined) {
                specifiers.add(posix.normalize(posix.join(posix.dirname(path), specifier)));
            }
        }
    }
    return [...specifiers];
}

export async function runTrustedGithubWriteCommand(
    command: TrustedGithubWriteCommand,
    args: string[],
    port: TrustedSourcePort
): Promise<number> {
    assertTrustedSourceGraph(command, port);
    const run = await port.loadCommand(command);
    return run(args);
}

function captureGit(repositoryRoot: string, args: string[]): string {
    const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout;
}

function originMainSource(repositoryRoot: string, path: string): string | undefined {
    const exists = spawnSync('git', ['cat-file', '-e', `origin/main:${path}`], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        shell: false,
    });
    if (exists.error !== undefined) {
        throw exists.error;
    }
    if (exists.status !== 0) {
        return undefined;
    }
    return captureGit(repositoryRoot, ['show', `origin/main:${path}`]);
}

function defaultPort(repositoryRoot: string): TrustedSourcePort {
    captureGit(repositoryRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
    return {
        readSource: (path) => readFileSync(resolve(repositoryRoot, path), 'utf8'),
        originMainSource: (path) => originMainSource(repositoryRoot, path),
        loadCommand: async (command) => {
            if (command === 'deliver') {
                const module = await import('./deliverPullRequest.ts');
                return module.runDeliverCli;
            }
            const module = await import('./reconcileTrackerIssue.ts');
            return module.runReconcileTrackerIssueCli;
        },
    };
}

function parseCommand(value: string | undefined): TrustedGithubWriteCommand {
    if (value === 'deliver' || value === 'issue:reconcile') {
        return value;
    }
    throw new Error('usage: trustedGithubWriteBootstrap.ts <deliver|issue:reconcile> [args...]');
}

async function main(): Promise<number> {
    const command = parseCommand(process.argv[2]);
    const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
    return runTrustedGithubWriteCommand(command, process.argv.slice(3), defaultPort(repositoryRoot));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
