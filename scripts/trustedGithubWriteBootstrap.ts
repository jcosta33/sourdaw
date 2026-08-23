#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
    accessSync,
    constants,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TrustedGithubWriteCommand = 'deliver' | 'issue:reconcile' | 'lane:publish';

export const BOOTSTRAP_PATH = 'scripts/trustedGithubWriteBootstrap.ts';

export const TRUSTED_PRIMARY_ROOT_ENV = 'SOURDAW_TRUSTED_PRIMARY_ROOT';
export const TRUSTED_COMMON_DIR_ENV = 'SOURDAW_TRUSTED_COMMON_DIR';
export const TRUSTED_GIT_PATH_ENV = 'SOURDAW_TRUSTED_GIT_PATH';
export const TRUSTED_GH_PATH_ENV = 'SOURDAW_TRUSTED_GH_PATH';
export const TRUSTED_ORIGIN_COMMIT_ENV = 'SOURDAW_TRUSTED_ORIGIN_COMMIT';

export type TrustedLauncherBinding = {
    primaryRoot: string;
    commonDir: string;
    gitPath: string;
    ghPath: string;
};

export type TrustedSourceSnapshot = {
    commit: string;
    sources: ReadonlyMap<string, string>;
    launcher?: TrustedLauncherBinding;
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

type SnapshotRunner = (
    entryPath: string,
    runner: string,
    args: string[],
    snapshot: TrustedSourceSnapshot
) => Promise<number>;

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
    return runTrustedGithubWriteCommandAtCommit(command, args, port, commit);
}

async function runTrustedGithubWriteCommandAtCommit(
    command: TrustedGithubWriteCommand,
    args: string[],
    port: TrustedSourcePort,
    commit: string
): Promise<number> {
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
    // The package route is accepted only from the protected primary checkout,
    // where this loader is compared with the pinned origin commit before the
    // closure runs. A lane path is command data; no lane package or helper is an
    // executable input to this process.
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
        const result = await runSnapshot(resolve(snapshotRoot, entry.path), entry.runner, args, snapshot);
        if (!Number.isSafeInteger(result)) {
            throw new TypeError(`trusted ${command} snapshot returned an invalid exit code`);
        }
        return result;
    } finally {
        rmSync(snapshotRoot, { recursive: true, force: true });
    }
}

async function runSnapshotModule(
    entryPath: string,
    runner: string,
    args: string[],
    snapshot: TrustedSourceSnapshot
): Promise<number> {
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
        env: trustedSnapshotEnv(snapshot),
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

export function trustedSnapshotEnv(
    snapshot: TrustedSourceSnapshot,
    parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env = trustedGitReadEnv(parent);
    const launcher = snapshot.launcher;
    if (launcher === undefined) {
        return env;
    }
    env.PATH = [...new Set([dirname(launcher.gitPath), dirname(launcher.ghPath), dirname(process.execPath)])].join(
        delimiter
    );
    env[TRUSTED_PRIMARY_ROOT_ENV] = launcher.primaryRoot;
    env[TRUSTED_COMMON_DIR_ENV] = launcher.commonDir;
    env[TRUSTED_GIT_PATH_ENV] = launcher.gitPath;
    env[TRUSTED_GH_PATH_ENV] = launcher.ghPath;
    env[TRUSTED_ORIGIN_COMMIT_ENV] = snapshot.commit;
    return env;
}

function captureGit(repositoryRoot: string, gitPath: string, args: string[]): string {
    const result = spawnSync(gitPath, args, {
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
            key.startsWith('SOURDAW_TRUSTED_') ||
            key.startsWith('NODE_') ||
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

export function resolveTrustedExecutable(name: 'git' | 'gh', parent: NodeJS.ProcessEnv = process.env): string {
    const extensions = process.platform === 'win32' ? (parent.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
    for (const directory of (parent.PATH ?? '').split(delimiter)) {
        for (const extension of extensions) {
            const candidate = resolve(directory || process.cwd(), `${name}${extension.toLowerCase()}`);
            try {
                accessSync(candidate, constants.X_OK);
                return realpathSync(candidate);
            } catch {
                // Try the next operator-provided PATH entry. The protected launcher freezes the
                // first executable it finds before any lane-selected child starts.
            }
        }
    }
    throw new Error(`cannot resolve trusted ${name} executable from the launcher PATH`);
}

function repositoryCommonDir(checkoutRoot: string, gitPath: string): string {
    const value = captureGit(checkoutRoot, gitPath, ['rev-parse', '--git-common-dir']).trim();
    return realpathSync(isAbsolute(value) ? value : resolve(checkoutRoot, value));
}

export function resolveTrustedLauncherBinding(
    launcherRoot: string,
    parent: NodeJS.ProcessEnv = process.env
): TrustedLauncherBinding {
    const root = realpathSync(launcherRoot);
    const gitPath = resolveTrustedExecutable('git', parent);
    const commonDir = repositoryCommonDir(root, gitPath);
    const primaryRoot = realpathSync(dirname(commonDir));
    if (root !== primaryRoot) {
        throw new Error('trusted GitHub writes must be launched from the protected primary checkout');
    }
    return {
        primaryRoot,
        commonDir,
        gitPath,
        ghPath: resolveTrustedExecutable('gh', parent),
    };
}

function defaultPort(binding: TrustedLauncherBinding): TrustedSourcePort {
    return {
        resolveOriginMain: () =>
            captureGit(binding.primaryRoot, binding.gitPath, [
                'rev-parse',
                '--verify',
                'refs/remotes/origin/main^{commit}',
            ]).trim(),
        readOriginSource: (commit, path) =>
            captureGit(binding.primaryRoot, binding.gitPath, ['show', `${commit}:${path}`]),
        executeSnapshot: (command, args, snapshot) =>
            executeTrustedSnapshot(command, args, { ...snapshot, launcher: binding }),
    };
}

function parseCommand(value: string | undefined): TrustedGithubWriteCommand {
    if (value === 'deliver' || value === 'issue:reconcile' || value === 'lane:publish') {
        return value;
    }
    throw new Error('usage: trustedGithubWriteBootstrap.ts <deliver|issue:reconcile|lane:publish> [args...]');
}

async function main(): Promise<number> {
    const executingFile = fileURLToPath(import.meta.url);
    const launcherRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const binding = resolveTrustedLauncherBinding(launcherRoot);
    const command = parseCommand(process.argv[2]);
    const port = defaultPort(binding);
    const commit = port.resolveOriginMain();
    const originBootstrap = port.readOriginSource(commit, BOOTSTRAP_PATH);
    if (readFileSync(executingFile, 'utf8') !== originBootstrap) {
        throw new Error('protected primary launcher does not match its pinned origin/main snapshot');
    }
    return runTrustedGithubWriteCommandAtCommit(command, process.argv.slice(3), port, commit);
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
