import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { TRUSTED_GH_PATH_ENV, TRUSTED_GIT_PATH_ENV } from './prContract.ts';

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

/**
 * The program a path starts, without the `.exe` suffix the launcher resolves on Windows, in lower
 * case because Windows file names ignore it.
 */
export function executableName(command: string): string {
    return basename(command)
        .toLowerCase()
        .replace(/\.exe$/u, '');
}

/** A variable the GitHub CLI reads a token from, matched ignoring case as a Windows child does. */
export function isGithubTokenKey(key: string): boolean {
    return GITHUB_TOKEN_ENV_KEYS.has(key.toUpperCase());
}

export function carriesGithubToken(env: NodeJS.ProcessEnv): boolean {
    return Object.entries(env).some(([key, value]) => value !== undefined && isGithubTokenKey(key));
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
 *
 * A child is gh when its command is named gh or is exactly the launcher's trusted gh path, which is
 * a resolved real path and so may carry another file name.
 */
export function withGhChildLocation<Result>(
    childCommand: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv | undefined,
    body: (location: { cwd: string; env: NodeJS.ProcessEnv | undefined }) => Result
): Result {
    if (
        !isGhChild(childCommand, env ?? process.env) ||
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

function isGitHubCliKey(key: string): boolean {
    return key.toUpperCase().startsWith('GH_') || isGithubTokenKey(key);
}

/**
 * Git authenticates only through the credential helper `gitAuthenticatedArgs` installs, so no git child
 * needs the GitHub CLI's token or config directory. Dropping them keeps the token from every program a
 * lane's config or attributes select for a local command: filters, merge and diff drivers, textconv.
 */
export function tokenFreeGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(env).filter(([key]) => !isGitHubCliKey(key)));
}

/**
 * A child is git by the command the caller named, never by the file name of the path it starts: the
 * launcher's trusted path is the real path of the `git` it found, which is `git.exe` on Windows and
 * may carry another name entirely. A caller that passes that trusted path itself names git too.
 */
function isGhChild(command: string, env: NodeJS.ProcessEnv): boolean {
    return executableName(command) === 'gh' || command === env[TRUSTED_GH_PATH_ENV];
}

export function isGitChild(command: string, env: NodeJS.ProcessEnv): boolean {
    return executableName(command) === 'git' || command === env[TRUSTED_GIT_PATH_ENV];
}

const VALUELESS_GIT_GLOBAL_OPTIONS = new Set([
    '--no-replace-objects',
    '--no-pager',
    '--no-optional-locks',
    '--literal-pathspecs',
    '--bare',
]);

/** The valued global options a token-bearing git child may carry, spelled `--name=value`. */
const VALUED_GIT_GLOBAL_OPTIONS = ['--git-dir='] as const;

/**
 * The options before a git subcommand, which can change the repository and config it reads. `-C` and
 * `-c` pairs, the listed valued options and the listed valueless flags are recognised; any other
 * leading option throws, because the hook listing must read the repository the child will run in and
 * options such as `--config-env` and `--exec-path` add config or choose the programs git runs.
 */
function gitGlobalOptions(args: readonly string[]): string[] {
    const options: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === undefined) {
            return options;
        }
        if (arg === '-C' || arg === '-c') {
            const value = args[index + 1];
            if (value === undefined) {
                throw new Error(`git option ${arg} has no value`);
            }
            options.push(arg, value);
            index += 1;
        } else if (
            VALUED_GIT_GLOBAL_OPTIONS.some((option) => arg.startsWith(option)) ||
            VALUELESS_GIT_GLOBAL_OPTIONS.has(arg)
        ) {
            options.push(arg);
        } else if (arg.startsWith('-')) {
            throw new Error(`refusing a token-bearing git child: unrecognised leading option ${arg}`);
        } else {
            return options;
        }
    }
    return options;
}

/**
 * Git config section and variable names ignore case, and `credential.<url>.helper` installs a helper
 * for the URLs it matches, so every such key installs one.
 */
function isCredentialHelperKey(key: string): boolean {
    return /^credential(?:\..*)?\.helper$/isu.test(key);
}

/**
 * Git splits a `-c` value at its first `=` and treats a value without one as `true`; only an empty
 * value resets the helper list. A `--config-env` value splits at its last `=` and takes its value from
 * the environment variable it names, so it always counts as installing.
 */
function configValueInstallsCredentialHelper(spec: string): boolean {
    const separator = spec.indexOf('=');
    if (separator === -1) {
        return isCredentialHelperKey(spec);
    }
    return isCredentialHelperKey(spec.slice(0, separator)) && spec.slice(separator + 1) !== '';
}

function configEnvInstallsCredentialHelper(spec: string): boolean {
    const separator = spec.lastIndexOf('=');
    return separator > 0 && isCredentialHelperKey(spec.slice(0, separator));
}

function argumentInstallsCredentialHelper(arg: string, previous: string | undefined): boolean {
    if (previous === '-c') {
        return configValueInstallsCredentialHelper(arg);
    }
    if (previous === '--config-env') {
        return configEnvInstallsCredentialHelper(arg);
    }
    return arg.startsWith('--config-env=') && configEnvInstallsCredentialHelper(arg.slice('--config-env='.length));
}

/** Environment config reaches git like `-c`; any mention of a helper key there counts as installing one. */
function environmentInstallsCredentialHelper(env: NodeJS.ProcessEnv): boolean {
    return Object.entries(env).some(([key, value]) => {
        const normalizedKey = key.toUpperCase();
        return (
            value !== undefined &&
            ((normalizedKey === 'GIT_CONFIG_PARAMETERS' && /credential(?:\..*)?\.helper/isu.test(value)) ||
                (normalizedKey.startsWith('GIT_CONFIG_KEY_') && isCredentialHelperKey(value)))
        );
    });
}

function installsCredentialHelper(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
    return (
        args.some((arg, index) => argumentInstallsCredentialHelper(arg, args[index - 1])) ||
        environmentInstallsCredentialHelper(env)
    );
}

/**
 * A git child carries a token when it installs a credential helper: a program it runs could call
 * `git credential fill` through the `-c` overrides git passes down in `GIT_CONFIG_PARAMETERS` and
 * read the token back. A caller that still hands a GitHub token variable to a git child is treated
 * the same, although the child itself never receives it (`tokenFreeGitEnv`).
 */
function isTokenBearingGitChild(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
    return carriesGithubToken(env) || installsCredentialHelper(args, env);
}

function gitEnvironmentEntries(env: NodeJS.ProcessEnv): Map<string, string> {
    return new Map(
        Object.entries(env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined && entry[0].toUpperCase().startsWith('GIT_')
        )
    );
}

/**
 * Git also reads config from the environment: global and system files (`GIT_CONFIG_GLOBAL`, or
 * `HOME` and `XDG_CONFIG_HOME` when it is unset), `GIT_CONFIG_PARAMETERS`, numbered entries, and
 * `GIT_EXEC_PATH` chooses the transport programs it runs. Any of them could rewrite the remote or
 * name a program beside the helper, so a credential-holding child's `GIT_*` environment must be
 * exactly the sterile one, keys matched as written: a key that differs only in case is refused too,
 * because a Windows child reads it.
 */
function assertSterileGitEnvironment(env: NodeJS.ProcessEnv, sterileEnvironment: NodeJS.ProcessEnv): void {
    const actual = gitEnvironmentEntries(env);
    const sterile = gitEnvironmentEntries(sterileEnvironment);
    const changed = [...actual.keys(), ...sterile.keys()].find((key) => actual.get(key) !== sterile.get(key));
    if (changed !== undefined) {
        throw new Error(`refusing a token-bearing git child: its environment changes ${changed}`);
    }
}

/**
 * Config-defined hooks (`hook.<name>.event` with `hook.<name>.command`) run whatever
 * `core.hooksPath` says, and `<name>` is the lane's choice, so no fixed-name override disarms them.
 * A token-bearing git child therefore refuses to start while the config it reads defines any
 * `hook.*` key. The listing runs in the child's repository without the token; reading config runs no
 * hook or fsmonitor. `git config --get-regexp` exits 1 with no output when nothing matches; any other
 * failure refuses.
 */
function assertNoConfigDefinedHooks(
    childCommand: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv
): void {
    const listing = spawnSync(childCommand, [...gitGlobalOptions(args), 'config', '-z', '--get-regexp', '^hook\\.'], {
        cwd,
        env: tokenFreeGitEnv(env),
        encoding: 'utf8',
        shell: false,
    });
    if (listing.error !== undefined) {
        throw listing.error;
    }
    if (listing.status === 1 && listing.stdout === '') {
        return;
    }
    if (listing.status !== 0) {
        throw new Error(
            `refusing a token-bearing git child: cannot list hook config (${listing.stderr.trim() || `exit ${String(listing.status ?? 'signal')}`})`
        );
    }
    const firstKey = listing.stdout.split('\n')[0] ?? '';
    throw new Error(`refusing a token-bearing git child: repository config defines ${firstKey}`);
}

/**
 * The checks a git child must pass before it starts, given `sterileEnvironment`, the environment
 * `githubAuthorizationGitEnv` gives every child whatever its parent held.
 */
export function assertTokenBearingGitChildIsHookFree(
    command: string,
    childCommand: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    sterileEnvironment: NodeJS.ProcessEnv
): void {
    if (!isGitChild(command, env) || !isTokenBearingGitChild(args, env)) {
        return;
    }
    if (installsCredentialHelper(args, env)) {
        assertRunsInLiveIsolatedGitDirectory(gitGlobalOptions(args), env);
        assertSterileGitEnvironment(env, sterileEnvironment);
    }
    assertNoConfigDefinedHooks(childCommand, args, cwd, env);
}
