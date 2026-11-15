import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** The git directories `createIsolatedGitDirectory` made that have not been released yet. */
const liveIsolatedGitDirectories = new Set<string>();

/**
 * A fresh, empty directory for `withIsolatedGitTransport` to write a git directory into. Only a path
 * this returned, until `releaseIsolatedGitDirectory` retires it, may hold a credential-holding git
 * child (`assertRunsInLiveIsolatedGitDirectory`).
 */
export function createIsolatedGitDirectory(): string {
    const gitDir = mkdtempSync(join(tmpdir(), 'sourdaw-git-transport-'));
    liveIsolatedGitDirectories.add(gitDir);
    return gitDir;
}

export function releaseIsolatedGitDirectory(gitDir: string): void {
    liveIsolatedGitDirectories.delete(gitDir);
}

/** The `--git-dir=` values among global options; a `-C` or `-c` value is data, never an option. */
function gitDirOptions(globalOptions: readonly string[]): string[] {
    const gitDirs: string[] = [];
    for (let index = 0; index < globalOptions.length; index += 1) {
        const option = globalOptions[index] ?? '';
        if (option === '-C' || option === '-c') {
            index += 1;
        } else if (option.startsWith('--git-dir=')) {
            gitDirs.push(option.slice('--git-dir='.length));
        }
    }
    return gitDirs;
}

/**
 * A credential reaches git only through a helper, and a lane can write the config and attributes of
 * every lane and of the primary checkout. A child that installs a helper therefore must run against a
 * git directory `withIsolatedGitTransport` created and still holds, whose config only the script
 * writes, so no lane-chosen transport, remote helper, URL rewrite or `http.*` setting applies beside
 * the token. Naming `--git-dir` proves nothing alone: it could name the shared repository. Every
 * `--git-dir` must match a live directory exactly, because git honours the last one and a path that
 * only resolves to a live directory has not been proven to. `GIT_COMMON_DIR` survives `--git-dir` and
 * moves where git reads config from, so a child whose environment names it refuses too; the match
 * ignores case because a Windows child's environment does.
 */
export function assertRunsInLiveIsolatedGitDirectory(globalOptions: readonly string[], env: NodeJS.ProcessEnv): void {
    const gitDirs = gitDirOptions(globalOptions);
    const redirectsCommonDir = Object.keys(env).some((key) => key.toUpperCase() === 'GIT_COMMON_DIR');
    if (
        redirectsCommonDir ||
        gitDirs.length === 0 ||
        !gitDirs.every((gitDir) => liveIsolatedGitDirectories.has(gitDir))
    ) {
        throw new Error('refusing a token-bearing git child outside an isolated git directory');
    }
}

const GITHUB_TOKEN_ENV_KEYS = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']);

/** Inherited routing that would point a git child at a repository whatever directory it starts in. */
const GIT_REPOSITORY_ROUTING_KEYS = new Set([
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
    'GIT_CEILING_DIRECTORIES',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM',
]);

/** `gh repo view` names the checkout's repository from its git remotes, so only it reads one. */
const CHECKOUT_REPOSITORY_QUERY = ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'] as const;

/** The program a path starts, without the `.exe` suffix the launcher resolves on Windows. */
function executableName(command: string): string {
    return basename(command).replace(/\.exe$/iu, '');
}

function carriesGithubToken(env: NodeJS.ProcessEnv): boolean {
    return Object.entries(env).some(
        ([key, value]) => value !== undefined && GITHUB_TOKEN_ENV_KEYS.has(key.toUpperCase())
    );
}

function isCheckoutRepositoryQuery(args: readonly string[]): boolean {
    return (
        args.length === CHECKOUT_REPOSITORY_QUERY.length &&
        args.every((arg, index) => arg === CHECKOUT_REPOSITORY_QUERY[index])
    );
}

function repositoryFreeEnv(env: NodeJS.ProcessEnv, directory: string): NodeJS.ProcessEnv {
    const stripped: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(env)) {
        if (!GIT_REPOSITORY_ROUTING_KEYS.has(key.toUpperCase())) {
            stripped[key] = value;
        }
    }
    return { ...stripped, GIT_CEILING_DIRECTORIES: dirname(directory) };
}

/**
 * The GitHub CLI runs git itself, with its own environment, so every git it starts holds the token,
 * and a git that finds the primary checkout or a lane reads config any lane can write: the programs
 * and settings `withIsolatedGitTransport` keeps from the token. A token-bearing gh child therefore
 * starts in a fresh empty directory that git cannot climb out of (`GIT_CEILING_DIRECTORIES`), with
 * inherited repository routing removed, so any git it runs finds no repository and reads no
 * repository config. The temporary directory may itself lie inside a checkout: the resource guard
 * points `TMPDIR` into the primary.
 *
 * Every other gh call names its repository (`--repo` or an explicit `repos/<owner>/<name>` path) and
 * needs no checkout. The exception is the exact checkout repository query, which reads remote names
 * from the caller's repository; it runs `git remote -v` and `git config --get-regexp` there, which
 * read config but start no config-selected program.
 */
export function withGhChildLocation<Result>(
    childCommand: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv | undefined,
    body: (location: { cwd: string; env: NodeJS.ProcessEnv | undefined }) => Result
): Result {
    if (
        executableName(childCommand) !== 'gh' ||
        !carriesGithubToken(env ?? process.env) ||
        isCheckoutRepositoryQuery(args)
    ) {
        return body({ cwd, env });
    }
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-gh-child-')));
    try {
        return body({ cwd: directory, env: repositoryFreeEnv(env ?? process.env, directory) });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
