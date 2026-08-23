#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TrustedGithubWriteCommand = 'deliver' | 'issue:reconcile' | 'lane:publish';

export const BOOTSTRAP_PATH = 'scripts/trustedGithubWriteBootstrap.ts';

/** Set by a hoisting parent so the hoisted copy knows which repository it acts on. */
export const REPOSITORY_ROOT_ENV = 'SOURDAW_TRUSTED_REPOSITORY_ROOT';

export type TrustedSourceSnapshot = {
    commit: string;
    sources: ReadonlyMap<string, string>;
};

type TrustedSourcePort = {
    resolveOriginMain: () => string;
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
    'lane:publish': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/publishLane.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
};

const commandEntries: Record<TrustedGithubWriteCommand, { path: string; runner: string }> = {
    deliver: { path: 'scripts/deliverPullRequest.ts', runner: 'runDeliverCli' },
    'issue:reconcile': { path: 'scripts/reconcileTrackerIssue.ts', runner: 'runReconcileTrackerIssueCli' },
    'lane:publish': { path: 'scripts/publishLane.ts', runner: 'runPublishLaneCli' },
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
    // Every script the command *executes* is read from `origin/main` and run
    // from the snapshot below, so whatever a lane holds for those — mutated, or
    // merely older than main — cannot reach the GitHub write. Refusing on a
    // difference protected none of them any further, and it forced a lane that
    // had only fallen behind to merge main first. A merge can resolve cleanly
    // and leave generated artifacts stale, so that requirement cost real safety
    // to buy none.
    //
    // This file is not one of those, and the distinction is the whole security
    // story here. `pnpm deliver` resolves this loader from the lane's own root,
    // so the code that pins the commit, builds the snapshot and decides whether
    // to run it is always the working-tree copy; nothing in the snapshot imports
    // it, so the snapshot cannot vouch for it. The comparison removed above did
    // cover this one file, but only against honest drift — a hostile edit would
    // delete the check along with everything else — and honest drift is exactly
    // the behind-a-moved-main case this change exists to permit.
    //
    // Verifying the loader properly means re-executing main's copy rather than
    // refusing, and that cannot land here: main's copy derives the repository
    // root from its own module URL, so a copy executed out of a temporary
    // directory would run git against that directory. It needs a loader on main
    // that accepts the root from its caller, which is a later change, not this
    // one. Filed as #2671 rather than asserted away.
    const sources = new Map<string, string>();
    for (const path of trustedDependencyPaths(command)) {
        sources.set(path, port.readOriginSource(commit, path));
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
    const result = spawnSync('git', args, {
        cwd: repositoryRoot,
        env: trustedGitReadEnv(),
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout;
}

// This loader must remain self-contained until it has pinned and validated the source closure, so
// the Git-read environment intentionally duplicates the identity helper's policy instead of
// importing lane-local code before trust is established.
export function trustedGitReadEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parent };
    for (const key of Object.keys(env)) {
        if (
            key.startsWith('GIT_') ||
            key.startsWith('GH_') ||
            key.startsWith('GITHUB_') ||
            key.startsWith('SOURDAW_GITHUB_APP_') ||
            key === 'SSH_AUTH_SOCK'
        ) {
            delete env[key];
        }
    }
    env.GIT_CONFIG_GLOBAL = '/dev/null';
    env.GIT_CONFIG_SYSTEM = '/dev/null';
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_SSH_COMMAND = '/usr/bin/false';
    env.GIT_SSH = '/usr/bin/false';
    env.GCM_INTERACTIVE = 'never';
    return env;
}

/**
 * Hoisting exists because this file is the one member of the trusted closure
 * that runs as the lane holds it: `package.json` resolves it from the lane's
 * root, and nothing inside the snapshot imports it, so the snapshot cannot
 * vouch for it. Handing the whole invocation to main's copy is what makes the
 * loader trusted too, and it does that without refusing a lane that has merely
 * fallen behind — refusing is what forced a merge, and a merge can resolve
 * cleanly while leaving generated artifacts stale.
 *
 * The hop terminates because the copy hoisted to is byte-identical to origin's,
 * so it takes the other branch. It is skipped when origin's copy predates
 * `REPOSITORY_ROOT_ENV`: that copy derives the repository root from its own
 * module URL, so hoisting to it would run git against a temporary directory.
 */
export function shouldHoistToOrigin(executingSource: string, originSource: string): boolean {
    return executingSource !== originSource && originSource.includes(REPOSITORY_ROOT_ENV);
}

export async function hoistToOriginBootstrap(
    originSource: string,
    repositoryRoot: string,
    argv: string[],
    spawnBootstrap: (entryPath: string, argv: string[], repositoryRoot: string) => number = spawnOriginBootstrap
): Promise<number> {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-loader-'));
    try {
        const entry = resolve(root, 'trustedGithubWriteBootstrap.ts');
        writeFileSync(entry, originSource, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return spawnBootstrap(entry, argv, repositoryRoot);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function spawnOriginBootstrap(entryPath: string, argv: string[], repositoryRoot: string): number {
    const result = spawnSync(process.execPath, [entryPath, ...argv], {
        cwd: process.cwd(),
        env: { ...process.env, [REPOSITORY_ROOT_ENV]: repositoryRoot },
        stdio: 'inherit',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === null) {
        throw new Error(`trusted loader terminated by ${result.signal ?? 'unknown signal'}`);
    }
    return result.status;
}

function defaultPort(repositoryRoot: string): TrustedSourcePort {
    return {
        resolveOriginMain: () =>
            captureGit(repositoryRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']).trim(),
        readOriginSource: (commit, path) => captureGit(repositoryRoot, ['show', `${commit}:${path}`]),
        executeSnapshot: executeTrustedSnapshot,
    };
}

function parseCommand(value: string | undefined): TrustedGithubWriteCommand {
    if (value === 'deliver' || value === 'issue:reconcile' || value === 'lane:publish') {
        return value;
    }
    throw new Error('usage: trustedGithubWriteBootstrap.ts <deliver|issue:reconcile|lane:publish> [args...]');
}

async function main(): Promise<number> {
    const command = parseCommand(process.argv[2]);
    const executingFile = fileURLToPath(import.meta.url);
    // A hoisted copy runs from a temporary directory, where its own module URL
    // says nothing about which repository it is acting on, so the hoisting
    // parent names the root. Absent that, the root is this file's parent, which
    // is what a normal invocation wants.
    const repositoryRoot = resolve(process.env[REPOSITORY_ROOT_ENV] ?? fileURLToPath(new URL('..', import.meta.url)));
    const port = defaultPort(repositoryRoot);

    const originBootstrap = port.readOriginSource(port.resolveOriginMain(), BOOTSTRAP_PATH);
    if (shouldHoistToOrigin(readFileSync(executingFile, 'utf8'), originBootstrap)) {
        return hoistToOriginBootstrap(originBootstrap, repositoryRoot, process.argv.slice(2));
    }
    return runTrustedGithubWriteCommand(command, process.argv.slice(3), port);
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
