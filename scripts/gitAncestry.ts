import { spawnSync } from 'node:child_process';

/** The exit status is the answer: exit 1 is the false answer rather than a failure. */
export function isAncestorExitStatus(status: number | null, stderr: string): boolean {
    if (status === 0) {
        return true;
    }
    if (status === 1) {
        return false;
    }
    throw new Error(stderr.trim() || 'git merge-base --is-ancestor failed');
}

type AncestorSpawn = (
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; encoding: 'utf8'; shell: false }
) => { status: number | null; stderr: string };

/**
 * `git merge-base --is-ancestor` answers with its exit status and writes nothing, so it is spawned
 * directly rather than through a capturing helper. The spawn is injectable so the exit-status
 * reading can be exercised without a repository.
 */
export function shellIsAncestor(
    primaryRoot: string,
    env?: NodeJS.ProcessEnv,
    spawn: AncestorSpawn = spawnSync
): (commit: string, head: string) => boolean {
    return (commit, head) => {
        const result = spawn('git', ['merge-base', '--is-ancestor', commit, head], {
            cwd: primaryRoot,
            env,
            encoding: 'utf8',
            shell: false,
        });
        return isAncestorExitStatus(result.status, result.stderr);
    };
}
