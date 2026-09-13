import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REQUIRED_REPOSITORY } from '../githubAppIdentity.ts';
import {
    assertLandedStackParent,
    assertStackAcyclic,
    parseLaneStack,
    parseStackParents,
    readLaneStack,
    readRegisteredLaneStack,
    resolveStackParent,
    stackPublicationBase,
    writeLaneStack,
    type LaneStack,
    type StackParent,
} from '../stackedLanes.ts';
import { syncParentLane, syncParentShellPort, type SyncParentPort } from '../syncParentLane.ts';

const fork = 'a'.repeat(40);
const child = 'b'.repeat(40);
const main = 'c'.repeat(40);
const landed = 'd'.repeat(40);
const descriptor: LaneStack = {
    version: 1,
    childBranch: 'agent/child',
    parentBranch: 'agent/parent',
    forkHead: fork,
    parentHead: fork,
};
const parent: StackParent = {
    number: 12,
    branch: 'agent/parent',
    headSha: fork,
    state: 'OPEN',
    authorId: AUTHOR_BOT_NODE_ID,
    repository: REQUIRED_REPOSITORY,
};
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('stack lineage admission', () => {
    it('validates strict versioned metadata and rejects executable or cyclic fields', () => {
        expect(parseLaneStack(descriptor)).toEqual(descriptor);
        for (const invalid of [
            { ...descriptor, version: 2 },
            { ...descriptor, command: 'git push' },
            { ...descriptor, parentBranch: descriptor.childBranch },
            { ...descriptor, forkHead: 'HEAD' },
        ]) {
            expect(() => parseLaneStack(invalid)).toThrow(/invalid/);
        }
        expect(() =>
            assertStackAcyclic(descriptor, () => ({
                ...descriptor,
                childBranch: 'agent/parent',
                parentBranch: 'agent/child',
            }))
        ).toThrow(/cycle/);
    });

    it('preserves pinned identity, detects descriptor loss, and refuses reused branch lineage', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-stack-'));
        roots.push(root);
        expect(readRegisteredLaneStack(root, descriptor.childBranch, '')).toBeUndefined();
        expect(() => readRegisteredLaneStack(root, descriptor.childBranch, fork)).toThrow(/missing/);
        writeLaneStack(root, descriptor);
        writeLaneStack(root, { ...descriptor, parentPullRequest: 12 });
        expect(readLaneStack(root, descriptor.childBranch)?.parentPullRequest).toBe(12);
        expect(() => writeLaneStack(root, { ...descriptor, parentPullRequest: 13 })).toThrow(/replace/);
        expect(() => writeLaneStack(root, { ...descriptor, forkHead: child })).toThrow(/replace/);
        expect(() => readRegisteredLaneStack(root, descriptor.childBranch, child)).toThrow(/marker/);
    });

    it('requires exact author parent and refuses branch reuse or ambiguity', () => {
        const port = { parents: () => [parent], isAncestor: () => true };
        expect(resolveStackParent(descriptor, port)).toEqual(parent);
        for (const parents of [
            [{ ...parent, authorId: 'foreign' }],
            [{ ...parent, repository: 'foreign/repo' }],
            [parent, { ...parent, number: 13 }],
            [{ ...parent, state: 'CLOSED' as const }],
        ]) {
            expect(() => resolveStackParent(descriptor, { ...port, parents: () => parents })).toThrow();
        }
        expect(() =>
            resolveStackParent(
                { ...descriptor, parentPullRequest: 12 },
                { ...port, parents: () => [{ ...parent, number: 13 }] }
            )
        ).toThrow(/exactly one/);
    });

    it('uses parent for open publication and main only after squash reconciliation', () => {
        const port = { parents: () => [parent], isAncestor: () => true };
        expect(stackPublicationBase(descriptor, child, main, port).branch).toBe('agent/parent');
        expect(() =>
            stackPublicationBase(descriptor, child, main, { ...port, parents: () => [{ ...parent, headSha: child }] })
        ).toThrow(/moved/);
        const merged = { ...port, parents: () => [{ ...parent, state: 'MERGED' as const, mergeCommit: landed }] };
        expect(stackPublicationBase(descriptor, child, main, merged).branch).toBe('main');
        expect(() =>
            stackPublicationBase(descriptor, child, main, {
                ...merged,
                isAncestor: (a: string, d: string) => !(a === landed && d === child),
            })
        ).toThrow(/reconciliation/);
        expect(() => assertLandedStackParent(descriptor, child, main, merged)).toThrow(/reconciliation/);
        expect(assertLandedStackParent({ ...descriptor, parentPullRequest: 12 }, child, main, merged).number).toBe(12);
    });

    it('rejects unpaged or incomplete parent responses', () => {
        expect(() => parseStackParents('{}')).toThrow(/incomplete/);
        expect(() => parseStackParents('[{}]')).toThrow(/incomplete/);
    });
});

function git(root: string, ...args: string[]): string {
    return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_AUTHOR_NAME: 'Stack test',
            GIT_AUTHOR_EMAIL: 'stack@example.test',
            GIT_COMMITTER_NAME: 'Stack test',
            GIT_COMMITTER_EMAIL: 'stack@example.test',
        },
    }).trim();
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-stack-git-'));
    roots.push(root);
    git(root, 'init', '-b', 'main');
    writeFileSync(join(root, 'base'), 'base\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'chore: base');
    git(root, 'checkout', '-b', 'agent/parent');
    writeFileSync(join(root, 'parent'), 'parent\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'feat: parent');
    const forkHead = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-b', 'agent/child');
    writeFileSync(join(root, 'child'), 'child\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'feat: child');
    const childHead = git(root, 'rev-parse', 'HEAD');
    const stack = { ...descriptor, forkHead, parentHead: forkHead, parentPullRequest: 12 };
    let remote: StackParent = { ...parent, headSha: forkHead };
    let saved = stack;
    const port: SyncParentPort = {
        head: () => git(root, 'rev-parse', 'HEAD'),
        clean: () => git(root, 'status', '--porcelain') === '',
        main: () => git(root, 'rev-parse', 'main'),
        parents: () => [remote],
        isAncestor: (a, d) => {
            const result = spawnSync('git', ['merge-base', '--is-ancestor', a, d], { cwd: root });
            if (result.status !== 0 && result.status !== 1) {
                throw new Error('ancestor query failed');
            }
            return result.status === 0;
        },
        fetchParent: () => undefined,
        merge: (head) => {
            git(root, 'merge', '--no-ff', '--no-edit', head);
        },
        conflicts: () => git(root, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean),
        save: (next) => {
            saved = { ...next, parentPullRequest: next.parentPullRequest ?? 12 };
        },
    };
    return {
        root,
        stack,
        childHead,
        port,
        setParent: (next: StackParent) => {
            remote = next;
        },
        saved: () => saved,
    };
}

describe('ordinary merge stack synchronization', () => {
    it('fetches a published parent head absent from the child object database before checking ancestry', () => {
        const f = fixture();
        const remote = mkdtempSync(join(tmpdir(), 'sourdaw-stack-remote-'));
        roots.push(remote);
        git(remote, 'clone', '--no-hardlinks', f.root, '.');
        git(remote, 'checkout', '-b', 'agent/parent', 'origin/agent/parent');
        writeFileSync(join(remote, 'remote-only'), 'remote\n');
        git(remote, 'add', '.');
        git(remote, 'commit', '-m', 'feat: remote parent');
        const remoteHead = git(remote, 'rev-parse', 'HEAD');
        expect(spawnSync('git', ['cat-file', '-e', remoteHead], { cwd: f.root }).status).not.toBe(0);
        git(f.root, 'checkout', 'main');
        const childLane = mkdtempSync(join(tmpdir(), 'sourdaw-stack-child-'));
        roots.push(childLane);
        git(f.root, 'worktree', 'add', childLane, 'agent/child');
        git(f.root, 'worktree', 'lock', '--reason', 'active:sourdaw-author', childLane);
        const port = syncParentShellPort({
            lane: childLane,
            branch: 'agent/child',
            primaryRoot: f.root,
            gitPath: 'git',
            ghPath: 'fixture-gh',
            localEnv: process.env,
            session: { configDir: join(f.root, 'session'), env: { GH_TOKEN: 'ghs_fixture' }, dispose: () => undefined },
            capture: (command, args, options) => {
                if (command === 'fixture-gh') {
                    return JSON.stringify([
                        [
                            {
                                number: 12,
                                state: 'open',
                                merged_at: null,
                                head: {
                                    ref: 'agent/parent',
                                    sha: remoteHead,
                                    repo: { full_name: REQUIRED_REPOSITORY },
                                },
                                user: { node_id: AUTHOR_BOT_NODE_ID },
                            },
                        ],
                    ]);
                }
                return git(options?.cwd ?? f.root, ...args);
            },
            run: (_command, args, options) => {
                if (args.includes('fetch')) {
                    git(options?.cwd ?? f.root, 'fetch', remote, args.at(-1) ?? '');
                    return;
                }
                git(options?.cwd ?? childLane, ...args);
            },
        });
        const result = syncParentLane(f.stack, port);
        expect(port.isAncestor(remoteHead, result)).toBe(true);
        expect(port.isAncestor(f.childHead, result)).toBe(true);
    });

    it('routes real adapter merges only to the child and fetches exact refs with isolated environments', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-stack-adapter-'));
        roots.push(root);
        const session = {
            configDir: join(root, 'session'),
            env: { GH_TOKEN: 'ghs_test_only_token' },
            dispose: () => undefined,
        };
        const localEnv = { PATH: '/safe/bin' };
        const writes: Array<{
            command: string;
            args: string[];
            cwd: string | undefined;
            env: NodeJS.ProcessEnv | undefined;
        }> = [];
        const reads: string[][] = [];
        const port = syncParentShellPort({
            lane: join(root, 'child'),
            branch: 'agent/child',
            primaryRoot: root,
            gitPath: '/trusted/git',
            ghPath: '/trusted/gh',
            session,
            localEnv,
            capture: (_command, args) => {
                reads.push(args);
                return args.includes('FETCH_HEAD^{commit}') ? fork : main;
            },
            run: (command, args, options) => {
                writes.push({ command, args, cwd: options?.cwd, env: options?.env });
            },
        });
        port.fetchParent('agent/parent', fork);
        expect(port.main()).toBe(main);
        port.merge(fork);
        port.save(descriptor);
        expect(readLaneStack(root, descriptor.childBranch)).toEqual(descriptor);
        expect(writes.every((call) => call.command === '/trusted/git')).toBe(true);
        expect(writes[0]?.args.slice(-3)).toEqual(['fetch', 'https://github.com/jcosta33/sourdaw.git', fork]);
        expect(writes[1]?.args.at(-1)).toBe('+refs/heads/main:refs/remotes/origin/main');
        expect(writes.slice(0, 2).every((call) => call.cwd === root && call.env === session.env)).toBe(true);
        expect(writes[2]).toMatchObject({ cwd: join(root, 'child'), env: localEnv });
        expect(writes[2]?.args.slice(-4)).toEqual(['merge', '--no-edit', '--no-ff', fork]);
        expect(
            writes.flatMap((call) => call.args).some((arg) => ['push', 'rebase', 'reset', '--force'].includes(arg))
        ).toBe(false);
        expect(reads).toContainEqual(['rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
    });

    it('removes inherited squash changes from the final diff and preserves the old child tip', () => {
        const f = fixture();
        git(f.root, 'checkout', 'main');
        git(f.root, 'merge', '--squash', 'agent/parent');
        git(f.root, 'commit', '-m', 'feat: landed parent');
        const mergeCommit = git(f.root, 'rev-parse', 'HEAD');
        f.setParent({ ...parent, headSha: f.stack.forkHead, state: 'MERGED', mergeCommit });
        git(f.root, 'checkout', 'agent/child');
        const result = syncParentLane(f.stack, f.port);
        expect(f.port.isAncestor(f.childHead, result)).toBe(true);
        expect(f.port.isAncestor(mergeCommit, result)).toBe(true);
        expect(git(f.root, 'diff', '--name-only', 'main...HEAD')).toBe('child');
        expect(readFileSync(join(f.root, 'parent'), 'utf8')).toBe('parent\n');
    });

    it('merges a newer published parent without altering the parent branch', () => {
        const f = fixture();
        git(f.root, 'checkout', 'agent/parent');
        writeFileSync(join(f.root, 'parent'), 'updated\n');
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-m', 'fix: parent');
        const next = git(f.root, 'rev-parse', 'HEAD');
        f.setParent({ ...parent, headSha: next });
        git(f.root, 'checkout', 'agent/child');
        syncParentLane(f.stack, f.port);
        expect(f.saved().parentHead).toBe(next);
        expect(git(f.root, 'rev-parse', 'agent/parent')).toBe(next);
        expect(f.port.isAncestor(f.childHead, f.port.head())).toBe(true);
    });

    it('reconciles a three-level stack bottom-up without rewriting the grandchild tip', () => {
        const f = fixture();
        git(f.root, 'checkout', '-b', 'agent/grandchild');
        writeFileSync(join(f.root, 'grandchild'), 'grandchild\n');
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-m', 'feat: grandchild');
        const oldGrandchild = git(f.root, 'rev-parse', 'HEAD');
        git(f.root, 'checkout', 'main');
        git(f.root, 'merge', '--squash', 'agent/parent');
        git(f.root, 'commit', '-m', 'feat: landed parent');
        f.setParent({
            ...parent,
            headSha: f.stack.forkHead,
            state: 'MERGED',
            mergeCommit: git(f.root, 'rev-parse', 'HEAD'),
        });
        git(f.root, 'checkout', 'agent/child');
        const reconciledChild = syncParentLane(f.stack, f.port);
        git(f.root, 'checkout', 'main');
        git(f.root, 'merge', '--squash', 'agent/child');
        git(f.root, 'commit', '-m', 'feat: landed child');
        const childLanded = git(f.root, 'rev-parse', 'HEAD');
        f.setParent({
            ...parent,
            number: 13,
            branch: 'agent/child',
            headSha: reconciledChild,
            state: 'MERGED',
            mergeCommit: childLanded,
        });
        git(f.root, 'checkout', 'agent/grandchild');
        const result = syncParentLane(
            {
                version: 1,
                childBranch: 'agent/grandchild',
                parentBranch: 'agent/child',
                forkHead: f.childHead,
                parentHead: f.childHead,
                parentPullRequest: 13,
            },
            f.port
        );
        expect(f.port.isAncestor(oldGrandchild, result)).toBe(true);
        expect(f.port.isAncestor(childLanded, result)).toBe(true);
        expect(git(f.root, 'diff', '--name-only', 'main...HEAD')).toBe('grandchild');
    });

    it('leaves conflicts in only the child and resumes after explicit author resolution', () => {
        const f = fixture();
        writeFileSync(join(f.root, 'parent'), 'child edit\n');
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-m', 'feat: child edit');
        git(f.root, 'checkout', 'agent/parent');
        writeFileSync(join(f.root, 'parent'), 'parent edit\n');
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-m', 'fix: parent edit');
        const next = git(f.root, 'rev-parse', 'HEAD');
        f.setParent({ ...parent, headSha: next });
        git(f.root, 'checkout', 'agent/child');
        expect(() => syncParentLane(f.stack, f.port)).toThrow(/conflict.*[\s\S]*parent/);
        expect(git(f.root, 'rev-parse', 'agent/parent')).toBe(next);
        writeFileSync(join(f.root, 'parent'), 'resolved\n');
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-m', 'fix: resolve parent');
        expect(syncParentLane(f.saved(), f.port)).toBe(f.port.head());
        expect(f.saved().parentHead).toBe(next);
    });
});
