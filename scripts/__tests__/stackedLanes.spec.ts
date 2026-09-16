import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function fixture(pinned = true) {
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
    const stack: LaneStack = { ...descriptor, forkHead, parentHead: forkHead };
    if (pinned) {
        stack.parentPullRequest = 12;
    }
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
            saved = next;
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
    it.each(['delete', 'revert', 'edit'])('preserves a later main %s after the parent squash lands', (change) => {
        const f = fixture();
        git(f.root, 'checkout', 'main');
        git(f.root, 'merge', '--squash', 'agent/parent');
        git(f.root, 'commit', '-m', 'feat: landed parent');
        const landedParent = git(f.root, 'rev-parse', 'HEAD');
        if (change === 'delete') {
            git(f.root, 'rm', 'parent');
            git(f.root, 'commit', '-m', 'fix: remove obsolete feature from main');
        } else if (change === 'revert') {
            git(f.root, 'revert', '--no-edit', landedParent);
        } else {
            writeFileSync(join(f.root, 'parent'), 'updated on main\n');
            git(f.root, 'add', 'parent');
            git(f.root, 'commit', '-m', 'fix: update feature on main');
        }
        const mainHead = git(f.root, 'rev-parse', 'HEAD');
        f.setParent({ ...parent, headSha: f.stack.parentHead, state: 'MERGED', mergeCommit: landedParent });
        git(f.root, 'checkout', 'agent/child');
        const result = syncParentLane(f.stack, f.port);
        expect(git(f.root, 'diff', '--name-only', 'main...HEAD')).toBe('child');
        if (change === 'edit') {
            expect(readFileSync(join(f.root, 'parent'), 'utf8')).toBe('updated on main\n');
        } else {
            expect(existsSync(join(f.root, 'parent'))).toBe(false);
        }
        for (const head of [f.childHead, f.stack.parentHead, landedParent, mainHead]) {
            expect(f.port.isAncestor(head, result)).toBe(true);
        }
        expect(stackPublicationBase(f.saved(), result, mainHead, f.port).branch).toBe('main');
        expect(assertLandedStackParent(f.saved(), result, mainHead, f.port).number).toBe(12);
    });
    it.each(['delete', 'revert'])('preserves the final parent %s when it squash-lands before child sync', (change) => {
        const f = fixture();
        let stack = f.stack;
        if (change === 'revert') {
            git(f.root, 'checkout', 'agent/parent');
            writeFileSync(join(f.root, 'base'), 'temporary parent change\n');
            git(f.root, 'add', '.');
            git(f.root, 'commit', '-m', 'feat: temporary parent change');
            const initialParent = git(f.root, 'rev-parse', 'HEAD');
            git(f.root, 'checkout', 'agent/child');
            git(f.root, 'merge', '--no-ff', '--no-edit', initialParent);
            stack = { ...stack, forkHead: initialParent, parentHead: initialParent };
        }
        const oldChild = git(f.root, 'rev-parse', 'HEAD');
        git(f.root, 'checkout', 'agent/parent');
        if (change === 'delete') {
            git(f.root, 'rm', 'parent');
        } else {
            writeFileSync(join(f.root, 'base'), 'base\n');
        }
        writeFileSync(join(f.root, 'retained'), 'retained parent feature\n');
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-m', 'fix: finalize parent');
        const finalParent = git(f.root, 'rev-parse', 'HEAD');
        git(f.root, 'checkout', 'main');
        git(f.root, 'merge', '--squash', 'agent/parent');
        git(f.root, 'commit', '-m', 'feat: landed parent');
        const landedParent = git(f.root, 'rev-parse', 'HEAD');
        f.setParent({ ...parent, headSha: finalParent, state: 'MERGED', mergeCommit: landedParent });
        git(f.root, 'checkout', 'agent/child');
        const result = syncParentLane(stack, f.port);
        expect(git(f.root, 'diff', '--name-only', 'main...HEAD')).toBe('child');
        expect(f.port.isAncestor(oldChild, result)).toBe(true);
        expect(f.port.isAncestor(finalParent, result)).toBe(true);
        expect(f.port.isAncestor(landedParent, result)).toBe(true);
        if (change === 'delete') {
            expect(existsSync(join(f.root, 'parent'))).toBe(false);
        } else {
            expect(readFileSync(join(f.root, 'base'), 'utf8')).toBe('base\n');
        }
        expect(stackPublicationBase(f.saved(), result, landedParent, f.port).branch).toBe('main');
        expect(assertLandedStackParent(f.saved(), result, landedParent, f.port).number).toBe(12);
    });

    it('rejects publication and approval after manually merging only landed main without final parent history', () => {
        const f = fixture();
        git(f.root, 'checkout', 'agent/parent');
        git(f.root, 'rm', 'parent');
        writeFileSync(join(f.root, 'retained'), 'retained\n');
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-m', 'fix: remove obsolete parent');
        const finalParent = git(f.root, 'rev-parse', 'HEAD');
        git(f.root, 'checkout', 'main');
        git(f.root, 'merge', '--squash', 'agent/parent');
        git(f.root, 'commit', '-m', 'feat: landed parent');
        const landedParent = git(f.root, 'rev-parse', 'HEAD');
        f.setParent({ ...parent, headSha: finalParent, state: 'MERGED', mergeCommit: landedParent });
        git(f.root, 'checkout', 'agent/child');
        git(f.root, 'merge', '--no-ff', '--no-edit', landedParent);
        const childHead = f.port.head();
        expect(f.port.isAncestor(landedParent, childHead)).toBe(true);
        expect(f.port.isAncestor(finalParent, childHead)).toBe(false);
        expect(() => stackPublicationBase(f.stack, childHead, landedParent, f.port)).toThrow(/reconciliation/);
        expect(() => assertLandedStackParent(f.stack, childHead, landedParent, f.port)).toThrow(/reconciliation/);
    });

    it.each(['parent', 'landed', 'main'])(
        'stops at a %s merge conflict and resumes both histories after author resolution',
        (stage) => {
            const f = fixture(false);
            expect(f.stack.parentPullRequest).toBeUndefined();
            const conflictPath = stage === 'parent' ? 'parent' : 'base';
            writeFileSync(join(f.root, conflictPath), 'child edit\n');
            git(f.root, 'add', '.');
            git(f.root, 'commit', '-m', 'feat: child edit');
            const oldChild = f.port.head();
            git(f.root, 'checkout', 'agent/parent');
            git(f.root, 'rm', 'parent');
            writeFileSync(join(f.root, 'retained'), 'retained\n');
            git(f.root, 'add', '.');
            git(f.root, 'commit', '-m', 'fix: finalize parent');
            const finalParent = git(f.root, 'rev-parse', 'HEAD');
            git(f.root, 'checkout', 'main');
            if (stage === 'landed') {
                writeFileSync(join(f.root, 'base'), 'main edit before landing\n');
                git(f.root, 'add', '.');
                git(f.root, 'commit', '-m', 'feat: main change before parent landing');
            }
            git(f.root, 'merge', '--squash', 'agent/parent');
            git(f.root, 'commit', '-m', 'feat: landed parent');
            const landedParent = git(f.root, 'rev-parse', 'HEAD');
            if (stage === 'main') {
                writeFileSync(join(f.root, 'base'), 'main edit\n');
                git(f.root, 'add', '.');
                git(f.root, 'commit', '-m', 'feat: main edit');
            }
            const mainHead = git(f.root, 'rev-parse', 'HEAD');
            f.setParent({ ...parent, headSha: finalParent, state: 'MERGED', mergeCommit: landedParent });
            git(f.root, 'checkout', 'agent/child');
            const merged: string[] = [];
            const merge = f.port.merge;
            f.port.merge = (target) => {
                merged.push(target);
                merge(target);
            };
            expect(() => syncParentLane(f.stack, f.port)).toThrow(new RegExp(`conflict[\\s\\S]*${conflictPath}`));
            const expectedMerges = [finalParent, landedParent];
            if (mainHead !== landedParent) {
                expectedMerges.push(mainHead);
            }
            expect(merged).toEqual(stage === 'parent' ? [finalParent] : expectedMerges);
            expect(f.saved().parentPullRequest).toBe(12);
            expect(f.saved().parentHead).toBe(f.stack.parentHead);
            expect(git(f.root, 'rev-parse', 'agent/parent')).toBe(finalParent);
            if (stage === 'parent') {
                git(f.root, 'rm', 'parent');
            } else {
                writeFileSync(join(f.root, 'base'), 'resolved\n');
                git(f.root, 'add', 'base');
            }
            git(f.root, 'commit', '-m', 'fix: resolve stack conflict');
            const resolvedHead = f.port.head();
            f.setParent({ ...parent, number: 13, headSha: finalParent, state: 'MERGED', mergeCommit: landedParent });
            expect(() => syncParentLane(f.saved(), f.port)).toThrow(/exactly one/);
            expect(f.saved().parentPullRequest).toBe(12);
            f.setParent({ ...parent, headSha: finalParent, state: 'MERGED', mergeCommit: landedParent });
            const result = syncParentLane(f.saved(), f.port);
            expect(f.port.isAncestor(oldChild, result)).toBe(true);
            expect(f.port.isAncestor(resolvedHead, result)).toBe(true);
            expect(f.port.isAncestor(finalParent, result)).toBe(true);
            expect(f.port.isAncestor(mainHead, result)).toBe(true);
            expect(f.saved().parentHead).toBe(finalParent);
            expect(merged).toEqual(expectedMerges);
        }
    );

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
