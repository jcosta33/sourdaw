import { lstatSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { gitAuthenticatedArgs } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import { createIsolatedGitDirectory, releaseIsolatedGitDirectory } from './tokenBearingChildPlacement.ts';

/** Runs git in one repository; the caller fixes the directory and the environment. */
export type GitRunner = {
    capture: (args: string[]) => string;
    run: (args: string[]) => void;
};

/** The only refs a transport carries back: the remote-tracking refs of `origin`. */
const TRACKING_NAMESPACE = 'refs/remotes/origin/';

type TrackingRefs = ReadonlyMap<string, string>;

/**
 * Every lane shares the primary checkout's repository config, `info/attributes` and object store, so
 * a lane can name the filter, merge or diff driver, remote helper, URL rewrite or `http.<url>.*`
 * setting any git command run there will use. No environment value can switch those keys off, because
 * the lane chooses their names. A command holding the token therefore never runs in a lane or the
 * primary: it runs against a fresh git directory whose config the script writes and whose `objects`
 * is the repository's own object store, so fetched objects land where later reads find them and
 * pushes find the objects they send.
 *
 * Only the network commands need the token, and none of them needs a working tree, an index or
 * attributes. Working-tree and object commands (status, diff, merge, show) run in the repository
 * itself without it.
 *
 * The directory starts with the repository's `origin` tracking refs, so fetch negotiation has the
 * local history to offer and `--prune` sees what it may prune. After `body` returns, every tracking
 * ref the transport changed is applied to the repository with its seeded value as the expected old
 * value, so a concurrent update refuses instead of being overwritten. Nothing else crosses back.
 */
export function withIsolatedGitTransport<Result>(
    repository: GitRunner,
    credential: { token: string; helperDir: string },
    body: (transport: GitRunner) => Result
): Result {
    const objects = repository.capture(['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
    if (!isAbsolute(objects)) {
        fail('repository object store did not resolve to an absolute path');
    }
    const objectFormat = repository.capture(['rev-parse', '--show-object-format']);
    if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
        fail(`unsupported repository object format: ${objectFormat}`);
    }
    const seeded = readTrackingRefs(repository.capture(trackingRefsArgs()));
    const gitDir = createIsolatedGitDirectory();
    try {
        writeIsolatedGitDir(gitDir, objects, objectFormat, seeded);
        const isolated = (args: string[]) => [
            `--git-dir=${gitDir}`,
            ...gitAuthenticatedArgs(credential.token, credential.helperDir, args),
        ];
        const result = body({
            capture: (args) => repository.capture(isolated(args)),
            run: (args) => repository.run(isolated(args)),
        });
        const fetched = readTrackingRefs(repository.capture([`--git-dir=${gitDir}`, ...trackingRefsArgs()]));
        applyTrackingRefChanges(repository, seeded, fetched, objectFormat);
        return result;
    } finally {
        releaseIsolatedGitDirectory(gitDir);
        removeIsolatedGitDir(gitDir);
    }
}

function trackingRefsArgs(): string[] {
    return ['for-each-ref', '--format=%(objectname) %(refname) %(symref)', TRACKING_NAMESPACE];
}

/** Symbolic refs such as `origin/HEAD` stay out: writing one through its target would move the target. */
function readTrackingRefs(output: string): TrackingRefs {
    const refs = new Map<string, string>();
    for (const line of output.split('\n')) {
        if (line.trim() === '') {
            continue;
        }
        const [oid, name, symref] = line.trim().split(' ');
        if (oid === undefined || name === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) {
            fail(`unreadable tracking ref line: ${line}`);
        }
        if (symref === undefined || symref === '') {
            refs.set(name, oid);
        }
    }
    return refs;
}

/**
 * Automatic gc and maintenance stay off: they would treat every object no isolated ref reaches as
 * garbage in the shared object store.
 */
function isolatedConfig(objectFormat: 'sha1' | 'sha256'): string {
    const lines = [
        '[core]',
        `\trepositoryformatversion = ${objectFormat === 'sha1' ? '0' : '1'}`,
        '\tbare = true',
        '\tlogAllRefUpdates = false',
        '[gc]',
        '\tauto = 0',
        '[maintenance]',
        '\tauto = false',
        '[fetch]',
        '\twriteCommitGraph = false',
    ];
    if (objectFormat === 'sha256') {
        lines.push('[extensions]', '\tobjectFormat = sha256');
    }
    return `${lines.join('\n')}\n`;
}

function writeIsolatedGitDir(
    gitDir: string,
    objects: string,
    objectFormat: 'sha1' | 'sha256',
    seeded: TrackingRefs
): void {
    writeFileSync(join(gitDir, 'config'), isolatedConfig(objectFormat), { mode: 0o600 });
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', { mode: 0o600 });
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true });
    mkdirSync(join(gitDir, 'refs', 'tags'), { recursive: true });
    const packed = Array.from(seeded, ([name, oid]) => `${oid} ${name}\n`).join('');
    writeFileSync(join(gitDir, 'packed-refs'), packed, { mode: 0o600 });
    symlinkSync(objects, join(gitDir, 'objects'), 'dir');
}

/** Pruned refs go first: a fetched ref may nest under a pruned one's name (`feature` replaced by `feature/x`). */
function applyTrackingRefChanges(
    repository: GitRunner,
    seeded: TrackingRefs,
    fetched: TrackingRefs,
    objectFormat: 'sha1' | 'sha256'
): void {
    for (const [name, oid] of seeded) {
        if (!fetched.has(name)) {
            repository.run(['update-ref', '--no-deref', '-d', name, oid]);
        }
    }
    const absent = '0'.repeat(objectFormat === 'sha1' ? 40 : 64);
    for (const [name, oid] of fetched) {
        const previous = seeded.get(name);
        if (previous !== oid) {
            repository.run(['update-ref', '--no-deref', name, oid, previous ?? absent]);
        }
    }
}

/** The `objects` link is removed on its own first, so the recursive removal never reaches the store. */
function removeIsolatedGitDir(gitDir: string): void {
    const link = join(gitDir, 'objects');
    try {
        if (lstatSync(link).isSymbolicLink()) {
            unlinkSync(link);
        }
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
    rmSync(gitDir, { recursive: true, force: true });
}
