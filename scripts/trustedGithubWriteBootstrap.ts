#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TrustedGithubWriteCommand = 'deliver' | 'issue:reconcile';

export type TrustedSourceSnapshot = {
    commit: string;
    sources: ReadonlyMap<string, string>;
};

type TrustedSourcePort = {
    resolveOriginMain: () => string;
    readLocalSource: (path: string) => string;
    readOriginSource: (commit: string, path: string) => string;
    executeSnapshot: (
        command: TrustedGithubWriteCommand,
        args: string[],
        snapshot: TrustedSourceSnapshot
    ) => Promise<number>;
};

type SnapshotRunner = (entryPath: string, runner: string, args: string[]) => Promise<number>;

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

const commandEntries: Record<TrustedGithubWriteCommand, { path: string; runner: string }> = {
    deliver: { path: 'scripts/deliverPullRequest.ts', runner: 'runDeliverCli' },
    'issue:reconcile': { path: 'scripts/reconcileTrackerIssue.ts', runner: 'runReconcileTrackerIssueCli' },
};

export function trustedDependencyPaths(command: TrustedGithubWriteCommand): readonly string[] {
    return trustedDependencyGraphs[command];
}

export function assertTrustedSourceGraph(
    command: TrustedGithubWriteCommand,
    sources: ReadonlyMap<string, string>
): void {
    const paths = trustedDependencyPaths(command);
    const pathSet = new Set(paths);
    for (const path of paths) {
        if (!sources.has(path)) {
            throw new Error(`trusted snapshot is missing ${path}`);
        }
    }
    for (const [path, source] of sources) {
        if (!pathSet.has(path)) {
            throw new Error(`trusted snapshot contains unexpected source ${path}`);
        }
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
    const commit = port.resolveOriginMain();
    if (commit.trim() === '') {
        throw new Error('origin/main did not resolve to a commit');
    }
    const sources = new Map<string, string>();
    for (const path of trustedDependencyPaths(command)) {
        const trustedSource = port.readOriginSource(commit, path);
        if (port.readLocalSource(path) !== trustedSource) {
            throw new Error(`${path} does not match origin/main at ${commit}; refusing to run a mutated copy`);
        }
        sources.set(path, trustedSource);
    }
    assertTrustedSourceGraph(command, sources);
    return port.executeSnapshot(command, args, { commit, sources });
}

export async function executeTrustedSnapshot(
    command: TrustedGithubWriteCommand,
    args: string[],
    snapshot: TrustedSourceSnapshot,
    runSnapshot: SnapshotRunner = runSnapshotModule
): Promise<number> {
    const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-write-'));
    try {
        for (const [path, source] of snapshot.sources) {
            if (!path.startsWith('scripts/') || posix.normalize(path) !== path || path.includes('..')) {
                throw new Error(`invalid trusted snapshot path ${path}`);
            }
            const target = resolve(snapshotRoot, path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        }
        const entry = commandEntries[command];
        const result = await runSnapshot(resolve(snapshotRoot, entry.path), entry.runner, args);
        if (!Number.isSafeInteger(result)) {
            throw new TypeError(`trusted ${command} snapshot returned an invalid exit code`);
        }
        return result;
    } finally {
        rmSync(snapshotRoot, { recursive: true, force: true });
    }
}

async function runSnapshotModule(entryPath: string, runner: string, args: string[]): Promise<number> {
    const source = [
        "import { pathToFileURL } from 'node:url';",
        'const [entryPath, runner, ...args] = process.argv.slice(1);',
        'const loaded = await import(pathToFileURL(entryPath).href);',
        'const command = Reflect.get(loaded, runner);',
        "if (typeof command !== 'function') throw new Error(`trusted snapshot does not export ${runner}`);",
        'const result = await command(args);',
        "if (!Number.isSafeInteger(result)) throw new Error('trusted snapshot returned an invalid exit code');",
        'process.exitCode = result;',
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source, entryPath, runner, ...args], {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === null) {
        throw new Error(`trusted snapshot terminated by ${result.signal ?? 'unknown signal'}`);
    }
    if (result.status !== 0) {
        throw new Error(`trusted snapshot failed with exit ${result.status}`);
    }
    return result.status;
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

function defaultPort(repositoryRoot: string): TrustedSourcePort {
    return {
        resolveOriginMain: () =>
            captureGit(repositoryRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']).trim(),
        readLocalSource: (path) => readFileSync(resolve(repositoryRoot, path), 'utf8'),
        readOriginSource: (commit, path) => captureGit(repositoryRoot, ['show', `${commit}:${path}`]),
        executeSnapshot: executeTrustedSnapshot,
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
