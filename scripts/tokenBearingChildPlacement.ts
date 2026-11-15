import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
